'use strict';

var Tree2Json = require('broccoli-tree-to-json'),
  RSVP = require('rsvp'),
  path = require('path'),
  fs = require('fs'),
  nano = require('nano'),
  lodash = require('lodash'),
  mktemp = require('mktemp'),
  mkdirp = require('mkdirp'),
  Traverser = require('broccoli-tree-traverser');


var DEFAULT_OPTIONS = {
    initDesign: false,
    manageDocs: true
  },
  PREFIX = 'CouchDB Versioning:';


function getTmpDir() {
  return process.env.TMPDIR || process.env.TMP;
}
/**
 *
 * Synchronize CouchDB design documents.
 * Options include
 *  * `url`: the couchdb url (http://host:123/db)
 *  * `username`: optional. used to authenticate with couchdb
 *  * `password`: required if username is present.
 *  * `initDesign`:optional. Set to true if the directory structure should be created from the existing database design
 *      documents. Defaults to false.
 *  * `manageDocs` Whether or not the docs tree should be managed during this run. Optional. Defaults to true.
 *
 * @param inputTree {string|tree} the input tree to monitor
 * @param options {Object} couchdb connection options
 * @return {CouchDBVersioning}
 * @constructor
 * @alias module:index
 */
function CouchDBVersioning(inputTree, options) {
  if (!(this instanceof CouchDBVersioning)) return new CouchDBVersioning(inputTree, options);

  options = lodash.merge(JSON.parse(JSON.stringify(DEFAULT_OPTIONS)), options);
  this.srcDir = inputTree;
  this.timestampDir = path.join(inputTree, '.revTimestamps');
  this.options = options;
  this.designTree = new Tree2Json(path.join(inputTree, '_design'));
  this.docTree = new Traverser(path.join(inputTree, 'docs'), this);

  this.initPromise = this.init(options)
    .catch(function (err) {
      console.trace(PREFIX, 'Init ERROR:', err);
    });
}

CouchDBVersioning.prototype.init = function (options) {
  return RSVP.all([this.initDesign(options),
    this.initTmpDir() ,
    this.initTimestampCache()
  ])
    .catch(function (err) {
      console.log(PREFIX, 'Init ERROR:', err);
    });
};

CouchDBVersioning.prototype.initDesign = function (options) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    if (options.initDesign) {
      mkdirp(path.join(self.srcDir, '_design'), function (err, made) {
        if (err) reject(err);
        else resolve(self.initExistingDesigns());
      });
    } else resolve();
  });
};

CouchDBVersioning.prototype.initConnection = function () {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    var connection = nano(self.options.url);

    if (self.options.username) {
      connection.auth(self.options.username, self.options.password, function (err, body, headers) {
        if (err) reject(err);
        else {
          self.connection = nano({url: self.options.url, cookie: headers['set-cookie'][0]});
          resolve();
        }
      });
    } else {
      self.connection = connection;
      resolve(connection);
    }
  });
};

CouchDBVersioning.prototype.initTmpDir = function () {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    mktemp.createDir(path.join(getTmpDir(), 'XXXXXXXX.tmp'), function (err, path) {
      if (err) {
        console.warn(PREFIX, 'WARN: Could not create temp dir');
        resolve();
      }
      else {
        self.tempDir = path;
        resolve(path)
      }
    });
  });
};

CouchDBVersioning.prototype.initTimestampCache = function () {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    mkdirp(self.timestampDir, function (err, made) {
      if (err) reject(err);
      else resolve();
    });
  });
};

function getFiles(destDir) {
  return new RSVP.Promise(function (resolve, reject) {
    fs.readdir(destDir, function (err, files) {
      if (err) reject(err);
      else resolve(files);
    });
  })
}

function readFile(dir, file) {
  return new RSVP.Promise(function (resolve, reject) {
    fs.readFile(path.join(dir, file), function (err, data) {
      if (err) reject(err);
      else resolve(JSON.parse(data.toString()));
    });
  });
}

function reportError(docName, date, localRev, serverRev) {
  console.log(PREFIX, 'ERROR:', date, docName + '._rev Conflict: local is', localRev, 'server is', serverRev);
}

/**
 * REDTAG:TJH
 * This code needs to be cleaned up
 * @param existingDesigns
 * @param localDesigns
 * @return {*}
 */
CouchDBVersioning.prototype.updateDesign = function (existingDesigns, localDesigns) {
  var self = this, updateTime = new Date().toISOString();
  return RSVP.all(Object.keys(localDesigns).map(function (designKey) {
    var designDoc = localDesigns[designKey], designName = '_design/' + designKey,
      existing = existingDesigns[designKey] || {_id: designName}, existingRevTimestamp = existing.revTimestamp,
      existingRev = existing._rev;

    designDoc._id = existing._id;

    delete existing.revTimestamp;
    delete existing._rev;
    delete designDoc._rev;

    if (!(existingRevTimestamp && lodash.isEqual(designDoc, existing))) {
      existing.revTimestamp = existingRevTimestamp;
      existing._rev = existingRev;
      //REDTAG:TJH - I should use either the design name, or a subdir, to avoid conflicts with documents
      return self.getRevTimestamp(designKey)
        .then(function (revTimestamp) {
          var docName, result = null;

          revTimestamp = revTimestamp || updateTime;
          designDoc.revTimestamp = revTimestamp;

          if (!existingRevTimestamp || revTimestamp >= existingRevTimestamp) {
            result = new RSVP.Promise(function (resolve, reject) {
              console.log(PREFIX, 'Updating', designName);
              designDoc.revTimestamp = updateTime;
              designDoc._rev = existing._rev;
              self.connection.insert(designDoc, designName, function (err, body) {
                if (err)reject(err);
                else {
                  resolve();
                }
              });
            }).then(function () {
                //REDTAG:TJH - I should use either the design name, or a subdir, to avoid conflicts with documents
                return self.updateRevTimestamp(designKey, updateTime);
              });
          } else {
            docName = '_design/' + designKey;
            reportError(docName, new Date(), revTimestamp, existingRevTimestamp);
          }
          return result;
        });
    } else {
      console.log(PREFIX, 'Skipping', designName, '. No changes detected');
    }
  }));
};

CouchDBVersioning.prototype.getRevTimestamp = function (key) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    fs.readFile(path.join(self.timestampDir, key + '.txt'), function (err, data) {
      if (err) {
        if (err.errno === 34) {
          resolve(null);
        } else {
          reject(err)
        }
      }
      else resolve(data.toString());
    });
  });
};

CouchDBVersioning.prototype.updateRevTimestamp = function (key, rev) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    var filePath = path.join(self.timestampDir, key + '.txt');
    fs.writeFile(filePath, rev, function (err, data) {
      if (err) {
        //NOTE:TJH Some deploys won't update the timestamp (read only dirs), so this shouldn't be fatal
        console.warn(PREFIX, 'WARN: Could not update', filePath, '. :', err);
      }
      resolve();
    });
  });
};

CouchDBVersioning.prototype.getExistingDesigns = function () {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    self.connection.get('_all_docs', {startkey: '_design', endkey: '_design0', include_docs: true},
      function (err, body) {
        var existing = {};
        if (err) reject(err);
        else {
          body.rows.forEach(function (row) {
            existing[row.id.split('/')[1]] = row.doc
          });
          resolve(existing);
        }
      });
  });
};

CouchDBVersioning.prototype.updateDocument = function (destDir, fileName, existingDesigns) {
  var self = this;

  return readFile(destDir, fileName)
    .then(function (json) {
      return self.updateDesign(existingDesigns, json);
    });
};

CouchDBVersioning.prototype.updateDesigns = function (destDir) {
  var self = this;
  return RSVP.hash({existingDesigns: this.getExistingDesigns(), files: getFiles(destDir)})
    .then(function (hash) {
      var files = hash.files, existingDesigns = hash.existingDesigns;
      return RSVP.all(files.map(function (fileName) {
        return self.updateDocument(destDir, fileName, existingDesigns);
      }));
    });
};

CouchDBVersioning.prototype.rebuildIndexes = function () {
  var self = this;
  return this.getExistingDesigns()
    .then(function (existingDesigns) {
      return RSVP.all(Object.keys(existingDesigns).map(function (designKey) {
        return new RSVP.Promise(function (resolve, reject) {
          var designDoc = existingDesigns[designKey];
          console.log(PREFIX, 'Rebuilding', designKey, 'views');
          self.connection.view(designKey, Object.keys(designDoc.views)[0], {limit: 1}, function (err) {
            if (err) reject(err);
            else {
              console.log(PREFIX, designKey, 'view rebuilding complete');
              resolve();
            }
          });
        });
      }));
    });
};

CouchDBVersioning.prototype.read = function (readTree) {
  var self = this;
  this.docFiles = [];
  return this.initPromise
    .then(function () {
      return RSVP.hash({
        connection: self.initConnection(),
        design: readTree(self.designTree)
      });
    }).then(function (hash) {
      console.log(PREFIX, 'Updating design documents');
      var promises = [self.updateDesigns(hash.design)];
      if (self.options.manageDocs) {
        promises.push(readTree(self.docTree));
      }
      return RSVP.all(promises);
    }).then(function () {
      if (self.options.manageDocs) {
        console.log(PREFIX, 'Updating other documents');
      }
      return self.updateDocs();
    }).then(function () {
      console.log(PREFIX, 'Rebuilding indexes');
      return self.rebuildIndexes();
    }).then(function () {
      return self.tempDir;
    }).catch(function (err) {
      console.trace(PREFIX, 'ERROR:', new Date(), err);
      return self.tempDir;
    });
};

CouchDBVersioning.prototype.visit = function (filePath) {
  this.docFiles.push(filePath);
};

/**
 * BATCH_SIZE is bound by the number of open files a platform allows.
 * On OS X, for example, no more than 10,240 files can be open by any process.
 * Since each doc file also produces a revStamp file, we can easily have
 * 2 * BATCH_SIZE files open at one time.
 *
 */
var BATCH_SIZE = 5000;
CouchDBVersioning.prototype.updateDocs = function () {
  var self = this, batches = [], i, promise = RSVP.resolve(null);

  for (i = 0; i < Math.ceil(this.docFiles.length / BATCH_SIZE); i++) {
    batches.push(this.docFiles.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE));
  }

  if (this.docFiles.length) {
    console.log(PREFIX, 'Processing', this.docFiles.length, 'files in', batches.length, 'batches');
  }

  batches.forEach(function (batch, i) {
    promise = promise.then(function () {
      return self.updateDocBatch(batch, i);
    });
  });

  return promise;
};

CouchDBVersioning.prototype._fetchDocsFromBatch = function (batch) {
  var self = this, keys = batch.map(function (batchFile) {
    return path.basename(batchFile, '.json');
  });

  return new RSVP.Promise(function (resolve, reject) {
    self.connection.fetch({keys: keys}, {include_docs: true}, function (err, docs) {
      if (err) {reject(err);}
      else { resolve(docs);}
    });
  });
};

CouchDBVersioning.prototype._createBatchUpdateTmp = function () {
  return new RSVP.Promise(function (resolve, reject) {
    mktemp.createFile(path.join(getTmpDir(), 'couchdb-versioning-XXXXXXXX.tmp'), function (err, filePath) {
      if (err) {reject(err);}
      else {
        resolve(filePath);
      }
    });
  });
};

CouchDBVersioning.prototype._updateRecordFromBatch = function (localDoc, existingDoc, timestamp) {
  existingDoc = existingDoc || {};
  var self = this;
  var existingTimestamp = existingDoc.revTimestamp, existingRev = existingDoc._rev;

  delete existingDoc.revTimestamp;
  delete existingDoc._rev;

  if (!(existingTimestamp && lodash.isEqual(localDoc, existingDoc))) {
    return this.getRevTimestamp(localDoc._id)
      .then(function (localTimestamp) {
        localDoc.revTimestamp = localTimestamp || timestamp;
        if (!existingTimestamp ||
          (existingDoc.error === 'not_found') ||
          (localDoc.revTimestamp >= existingTimestamp)) {
          localDoc._rev = existingRev;
          localDoc.revTimestamp = timestamp;

          return self.updateRevTimestamp(localDoc._id, localDoc.revTimestamp)
            .then(function () {
              return JSON.stringify(localDoc)
            });
        }
      });
  } else {
    return RSVP.resolve(null);
  }
};

CouchDBVersioning.prototype._loadUpdateFileFromBatch = function (batch, existingDocs, tmpFilePath) {
  var self = this, writeStream = fs.createWriteStream(tmpFilePath), now = new Date().toISOString(), addedRecord = false;
  writeStream.write('{"docs":[');
  return RSVP.all(batch.map(function (batchFile, i) {
    return new RSVP.Promise(function (resolve, reject) {
      fs.readFile(batchFile, function (err, data) {
        if (err) {reject(err);}
        else {
          var localDoc = JSON.parse(data.toString()), existingDoc = existingDocs.rows[i].doc;
          localDoc._id = path.basename(batchFile, '.json');
          self._updateRecordFromBatch(localDoc, existingDoc, now)
            .then(function (record) {
              if (record) {
                if (addedRecord) {
                  writeStream.write(', ');
                }
                writeStream.write(record);
                addedRecord = true;
              }
              resolve();
            });
        }
      });
    });
  })).then(function () {
    return new RSVP.Promise(function (resolve, reject) {
      writeStream.end(']}', function (err) {
        if (err) {reject(err);}
        else {resolve();}
      });
    });
  }).then(function () {
    return addedRecord;
  });
};

CouchDBVersioning.prototype._bulkUpdateDocs = function (filePath) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    fs.createReadStream(filePath)
      .pipe(self.connection.bulk())
      .on('end', function () {
        resolve();
      }).on('error', function (err) {
        console.trace(PREFIX, 'ERROR:', err);
        reject(err);
      });
  });
};

CouchDBVersioning.prototype.updateDocBatch = function (batch, batchNum) {
  var self = this, tmpFilePath;
  nano.debug = true;
  return RSVP.hash({
    existingDocs: self._fetchDocsFromBatch(batch),
    tmpFile: self._createBatchUpdateTmp()
  }).then(function (hash) {
    tmpFilePath = hash.tmpFile;
    console.log(PREFIX, 'Preparing batch', batchNum + 1);
    return self._loadUpdateFileFromBatch(batch, hash.existingDocs, hash.tmpFile);
  }).then(function (hasRecords) {
    if (hasRecords) {
      console.log(PREFIX, 'Pushing batch', batchNum + 1, 'to', self.options.url);
      return self._bulkUpdateDocs(tmpFilePath);
    } else {
      console.log(PREFIX, 'Nothing changed in batch', batchNum + 1, '. Skipping');
    }
  }).then(function () {
    console.log(PREFIX, 'Batch', batchNum + 1, 'complete');
    return new RSVP.Promise(function (resolve, reject) {
      fs.unlink(tmpFilePath, function (err) {
        if (err) {reject(err);}
        else {resolve();}
      })
    });
  });
};

CouchDBVersioning.prototype.cleanup = function () {
  this.designTree.cleanup();
  if (this.tempDir) fs.rmdirSync(this.tempDir);
};

CouchDBVersioning.prototype.writeDir = function (filePath, json) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    mkdirp(filePath, function (err, made) {
      var promises;
      if (err) reject(err);
      else {
        promises = Object.keys(json).map(function (key) {
          var val = json[key];
          var subPath = path.join(filePath, key);
          var result;
          if (val instanceof Array || typeof val !== 'object') {
            result = self.writeFile(subPath, val);
          } else {
            result = self.writeDir(subPath, val);
          }
          return result;
        });
        resolve(RSVP.all(promises));
      }
    });
  });
};

function escape(string) {
  return string.replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, '\\$1');
}

var JS_PATH = new RegExp(escape(path.sep + '((map)|(reduce))$'));
var SPECIAL_VALUES = new RegExp(escape(path.sep + 'revTimestamp$'));
var IGNORED_VALUES = new RegExp(escape(path.sep + '_id$'));
CouchDBVersioning.prototype.writeFile = function (filePath, data) {
  var elems;
  if (IGNORED_VALUES.test(filePath)) return false;
  if (SPECIAL_VALUES.test(filePath)) {
    elems = filePath.split(path.sep);
    return this.updateRevTimestamp(elems[elems.length - 2], data)
  }
  return new RSVP.Promise(function (resolve, reject) {
    var extension = JS_PATH.test(filePath) ? '.js' : '.txt';
    fs.writeFile(filePath + extension, data, function (err, data) {
      if (err) reject(err);
      else resolve();
    });
  });
};

CouchDBVersioning.prototype.initExistingDesigns = function () {
  var self = this;
  return this.initConnection()
    .then(function () {
      return self.getExistingDesigns();
    }).then(function (existing) {
      return RSVP.all(Object.keys(existing).map(function (designName) {
        var existingDesign = existing[designName];
        existingDesign.revTimestamp = existingDesign.revTimestamp || new Date().toISOString();
        return self.writeDir(path.join(self.srcDir, '_design', designName), existing[designName]);
      }));
    }).catch(function (err) {
      console.trace(PREFIX, 'ERROR:', new Date(), err);
    });
};

module.exports = CouchDBVersioning;