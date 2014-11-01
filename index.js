'use strict';

var Tree2Json = require('broccoli-tree-to-json'),
  RSVP = require('rsvp'),
  path = require('path'),
  fs = require('fs'),
  nano = require('nano'),
  lodash = require('lodash'),
  mktemp = require('mktemp'),
  mkdirp = require('mkdirp');

/**
 *
 * Synchronize CouchDB design documents.
 * Options include
 *  * `url`: the couchdb url (http://host:123/db)
 *  * `username`: optional. used to authenticate with couchdb
 *  * `password`: required if username is present.
 *  * `initDesign`:optional. Set to true if the directory structure should be created from the existing database design documents
 *
 * @param inputTree {string|tree} the input tree to monitor
 * @param options {Object} couchdb connection options
 * @return {CouchDBVersioning}
 * @constructor
 * @alias module:index
 */
function CouchDBVersioning(inputTree, options) {
  if (!(this instanceof CouchDBVersioning)) return new CouchDBVersioning(inputTree, options);

  this.srcDir = inputTree;
  this.revDir = inputTree + '/.rev';
  this.inputTree = new Tree2Json(inputTree + '/_design');

  this.initPromise = this.init(options);
}

CouchDBVersioning.prototype.init = function (options) {
  return RSVP.all([this.initDesign(options),
    this.initConnection(options),
    this.initTmpDir(),
    this.initRevCache()])
    .catch(function (err) {
      console.log('CouchDB Versioning initialization error:', err);
    });
};

CouchDBVersioning.prototype.initDesign = function (options) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    if (options.initDesign) {
      fs.lstat(self.srcDir + '/_design', function (err, stat) {
        if (err) {
          if (34 === err.errno) {
            mkdirp(process.env.PWD + '/' + self.srcDir + '/_design', function (err, made) {
              resolve(self.initExistingDesigns());
            });
          } else {
            reject(err);
          }
        } else {
          resolve(self.initExistingDesigns());
        }
      });
    } else resolve();
  });
};

CouchDBVersioning.prototype.initConnection = function (options) {
  var self = this;
  this.connectionPromise = new RSVP.Promise(function (resolve, reject) {
    var connection = nano(options.url);

    if (options.username) {
      connection.auth(options.username, options.password, function (err, body, headers) {
        if (err) reject(err);
        else {
          self.connection = nano({url: options.url, cookie: headers['set-cookie'][0]});
          resolve();
        }
      });
    } else {
      self.connection = connection;
      resolve();
    }
  });
  return  this.connectionPromise;
};

CouchDBVersioning.prototype.initTmpDir = function () {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    mktemp.createDir(path.join('tmp', 'XXXXXXXX.tmp'), function (err, path) {
      if (err) reject(err);
      else {
        self.tempDir = path;
        resolve(path)
      }
    });
  });
};

CouchDBVersioning.prototype.initRevCache = function () {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    mkdirp(self.revDir, function (err, made) {
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

function reportError(docName, date, localRev, serverRev, nag) {
  console.log(nag ? 'NAG:' : 'ERROR:', date, docName + '._rev Conflict: local is', localRev, 'server is', serverRev);
}

CouchDBVersioning.prototype.updateDesign = function (existingDesigns, design) {
  var self = this;
  return RSVP.all(Object.keys(design).map(function (key) {
    return new RSVP.Promise(function (resolve, reject) {
      var designDoc = design[key];
      var designName = '_design/' + key;
      var existing = existingDesigns[key];
      designDoc._id = existing._id;

      var checkRevPromise = self.getRev(key)
        .then(function (rev) {
          var docName;
          var serverRevNum = parseInt(existing._rev.split('-')[0]), localRevNum = parseInt(rev.split('-')[0]);

          /*
           NOTE - making some assumptions here. Generally development revs
           will outpace production revs, so we're allowing updates when local
           revs are equal or greater
           */
          if (localRevNum >= serverRevNum) {
            //fake out the rev for the equality test and update
            designDoc._rev = existing._rev;
            if (!lodash.isEqual(designDoc, existing)) {
              self.connection.insert(designDoc, designName, function (err, body) {
                if (err)reject(err);
                else {
                  return self.updateRev(key, body.rev);
                }
              });
            }
          } else {
            docName = '_design/' + key;
            reportError(docName, new Date(), rev, existing._rev);
            //nag
            setInterval(reportError, 10000, docName, new Date(), rev, existing._rev, true);
          }
        });
      resolve(checkRevPromise);
    });
  }));
};

CouchDBVersioning.prototype.getRev = function (key) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    fs.readFile(path.join(self.revDir, key + '.txt'), function (err, data) {
      if (err) reject(err);
      else resolve(data.toString());
    });
  });
};

CouchDBVersioning.prototype.updateRev = function (key, rev) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    fs.writeFile(path.join(self.revDir, key + '.txt'), rev, function (err, data) {
      if (err) reject();
      else resolve();
    });
  });
};

CouchDBVersioning.prototype.getExistingDesigns = function () {
  var self = this;
  return this.connectionPromise
    .then(function () {
      return new RSVP.Promise(function (resolve, reject) {
        self.connection.get('_all_docs', {startkey: '_design', endkey: '_design0', include_docs: true}, function (err, body) {
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
    });
};

CouchDBVersioning.prototype.updateDocument = function (destDir, fileName) {
  var self = this;
  return readFile(destDir, fileName)
    .then(function (json) {
      if ('_design.json' === fileName) {
        return self.getExistingDesigns()
          .then(function (existing) {
            return self.updateDesign(existing, json);
          });
      }
    });
};

CouchDBVersioning.prototype.updateCouch = function (destDir) {
  var self = this;
  return getFiles(destDir)
    .then(function (files) {
      return RSVP.all(files.map(function (fileName) {
        return self.updateDocument(destDir, fileName);
      }));
    });
};

CouchDBVersioning.prototype.read = function (readTree) {
  var self = this;
  return this.initPromise
    .then(function () {
      return readTree(self.inputTree)
    }).then(function (pDestDir) {
      return self.updateCouch(pDestDir);
    }).then(function () {
      return self.tempDir;
    }).catch(function(err){
      console.trace('CouchDBVersioning: ERROR:', new Date(), err);
    });
};

CouchDBVersioning.prototype.cleanup = function () {
  this.inputTree.cleanup();
  fs.rmdirSync(this.tempDir);
};

CouchDBVersioning.prototype.writeDir = function (filePath, json) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    mkdirp(filePath, function (err, made) {
      if (err) reject(err);
      else {
        Object.keys(json).forEach(function (key) {
          var val = json[key];
          var subPath = path.join(filePath, key);
          if (val instanceof Array || typeof val !== 'object') {
            resolve(self.writeFile(subPath, val));
          } else {
            resolve(self.writeDir(subPath, val));
          }
        });
      }
    });
  });
};

var JS_PATH = new RegExp(path.sep + '((map)|(reduce))$');
var SPECIAL_VALUES = new RegExp(path.sep + '_rev$');
var IGNORED_VALUES = new RegExp(path.sep + '_id$');
CouchDBVersioning.prototype.writeFile = function (filePath, data) {
  var elems;
  if (IGNORED_VALUES.test(filePath)) return false;
  if (SPECIAL_VALUES.test(filePath)) {
    elems = filePath.split(path.sep);
    return this.updateRev(elems[elems.length - 2], data)
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
  return this.getExistingDesigns()
    .then(function (existing) {
      return RSVP.all(Object.keys(existing).map(function (designName) {
        return self.writeDir(path.join(self.srcDir, '_design', designName), existing[designName]);
      }));
    }).catch(function(err){
      console.trace('CouchDBVersionin: ERROR:', new Date(), err);
    });
};

module.exports = CouchDBVersioning;