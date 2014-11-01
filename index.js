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

  var self = this;
  this.srcDir = inputTree;
  this.initPromise = new RSVP.Promise(function (resolve, reject) {
    if (options.initDesign) {
      fs.lstat(inputTree + '/_design', function (err, stat) {
        if (err && 34 === err.errno) {
          mkdirp(process.env.PWD + '/' + inputTree + '/_design', function (err, made) {
            resolve(self.initExistingDesigns());
          });
        } else {
          resolve(self.initExistingDesigns());
        }
      });
    } else resolve();
  });
  this.inputTree = new Tree2Json(inputTree + '/_design');
  this.couchConnectionPromise = new RSVP.Promise(function (resolve, reject) {
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

  this.tempDirPromise = new RSVP.Promise(function (resolve, reject) {
    mktemp.createDir((process.env.TMPDIR || '/tmp') + '/XXXXXXXX.tmp', function (err, path) {
      if (err) reject(err);
      else {
        resolve(path);
      }
    });
  });
}

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

CouchDBVersioning.prototype.updateDesign = function (existingDesigns, design) {
  var self = this;
  return RSVP.all(Object.keys(design).map(function (key) {
    return new RSVP.Promise(function (resolve, reject) {
      var designDoc = design[key];
      var designName = '_design/' + key;
      var existing = existingDesigns[key];

      if (!lodash.isEqual(designDoc, existing)) {
        self.connection.insert(designDoc, designName, function (err, body) {
          if (err)reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }));
};

CouchDBVersioning.prototype.getExistingDesigns = function () {
  var self = this;
  return this.couchConnectionPromise
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
      return self.tempDirPromise;
    });
};

CouchDBVersioning.prototype.cleanup = function () {
  this.inputTree.cleanup();
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

var JS_PATH = new RegExp(path.sep + '(map)|(reduce)$');
CouchDBVersioning.prototype.writeFile = function (filePath, data) {
  return new RSVP.Promise(function (resolve, reject) {
    var extension = JS_PATH.test(filePath) ? '.js' : '.txt';
    fs.writeFile(filePath + extension, data, function (err, data) {
      if (err) reject(err);
      else {
        resolve();
      }
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
    });
};

module.exports = CouchDBVersioning;