'use strict';

var Tree2Json = require('broccoli-tree-to-json'),
  RSVP = require('rsvp'),
  path = require('path'),
  fs = require('fs'),
  nano = require('nano'),
  lodash = require('lodash');

/**
 *
 * Synchronize CouchDB design documents.
 * Options include
 *  * `url`: the couchdb url (http://host:123/db)
 *  * `username`: optional. used to authenticate with couchdb
 *  * `password`: required if username is present.
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
  this.inputTree = new Tree2Json(inputTree);
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

function readFiles(dir, files) {
  return RSVP.all(files.map(function (fileName) {
    return readFile(dir, fileName);
  }));
}

CouchDBVersioning.prototype.updateDesign = function (name, design) {
  var self = this;
  return new RSVP.Promise(function (resolve, reject) {
    var designName = '_design/' + name;
    var existing = self.existingDesigns[name];

    design._id = existing._id;
    if (!lodash.isEqual(design, existing)) {
      self.connection.insert(design, designName, function (err, body) {
        if (err)reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
};

CouchDBVersioning.prototype.updateDoc = function (doc) {
  var self = this, designs = doc.design;
  return RSVP.all(Object.keys(designs).map(function (key) {
    return self.updateDesign(key, designs[key]);
  }));
};

CouchDBVersioning.prototype.getExistingDesigns = function () {
  var self = this;
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
};

CouchDBVersioning.prototype.updateDocuments = function (docs) {
  var self = this;
  return this.couchConnectionPromise
    .then(function () {
      return self.getExistingDesigns();
    }).then(function (existing) {
      self.existingDesigns = existing;
      return RSVP.all(docs.map(function (doc) {
        return self.updateDoc(doc);
      }));
    });
};

CouchDBVersioning.prototype.updateCouch = function (destDir) {
  var self = this;
  return getFiles(destDir)
    .then(function (files) {
      return readFiles(destDir, files);
    }).then(function (jsons) {
      return self.updateDocuments(jsons);
    });
};

CouchDBVersioning.prototype.read = function (readTree) {
  var self = this, destDir;
  return readTree(this.inputTree)
    .then(function (pDestDir) {
      destDir = pDestDir;
      return self.updateCouch(destDir);
    }).then(function () {
      return destDir;
    });
};

CouchDBVersioning.prototype.cleanup = function () {
  this.inputTree.cleanup();
};

module.exports = CouchDBVersioning;