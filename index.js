'use strict';

var Tree2Json = require('broccoli-tree-to-json'),
  RSVP = require('rsvp'),
  path = require('path'),
  fs = require('fs'),
  nano = require('nano'),
  lodash = require('lodash'),
  mktemp = require('mktemp');

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
    mktemp.createDir('XXXXXXXX.tmp', function (err, path) {
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

CouchDBVersioning.prototype.updateDesign = function (design) {
  var self = this;
  return RSVP.all(Object.keys(design).map(function (key) {
    return new RSVP.Promise(function (resolve, reject) {
      var designDoc = design[key];
      var designName = '_design/' + key;
      var existing = self.existingDesigns[key];

      if(existing){
        designDoc._id = existing._id;
        designDoc._rev = existing._rev;
      }
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
            self.existingDesigns = existing;
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
        return self.updateDesign(json);
      }
    })
};

CouchDBVersioning.prototype.updateCouch = function (destDir) {
  var self = this;
  return RSVP.all([getFiles(destDir), this.getExistingDesigns()])
    .then(function (filesDesigns) {
      var files = filesDesigns[0];
      return RSVP.all(files.map(function (fileName) {
        return self.updateDocument(destDir, fileName);
      }));
    });
};

CouchDBVersioning.prototype.read = function (readTree) {
  var self = this;
  return readTree(this.inputTree)
    .then(function (pDestDir) {
      return self.updateCouch(pDestDir);
    }).then(function () {
      return self.tempDirPromise;
    });
};

CouchDBVersioning.prototype.cleanup = function () {
  this.inputTree.cleanup();
};

module.exports = CouchDBVersioning;