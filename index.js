'use strict';

var Tree2Json = require('broccoli-tree-to-json'),
  RSVP = require('rsvp'),
  path = require('path'),
  fs = require('fs'),
  nano = require('nano');

function CouchDBVersioning(inputTree, options) {
  if (!(this instanceof CouchDBVersioning)) return new CouchDBVersioning(inputTree, options);

  console.log('init');
  var self = this;
  this.inputTree = new Tree2Json(inputTree);
  this.couchConnectionPromise = new RSVP.Promise(function (resolve, reject) {
    var connection = nano(options.url);

    if (options.username) {
      connection.auth(options.username, options.password, function (err, body, headers) {
        if (err) reject(err);
        else {
          console.log('resolving connection');
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
  var designName = '_design/' + name;
  return new RSVP.Promise(function (resolve, reject) {

    function insert() {
      self.connection.insert(design, designName, function (err, body) {
        if (err)reject(err);
        else resolve();
      });
    }

    self.connection.get(designName, function (err, body) {
      if (err) {
        if (err.status_code === 404) insert();
        else reject(err);
      }
      else {
        design._rev = body._rev;
        insert();
      }
    });
  });
};

CouchDBVersioning.prototype.updateDoc = function (doc) {
  var self = this, designs = doc.design;
  return RSVP.all(Object.keys(designs).map(function (key) {
    return self.updateDesign(key, designs[key]);
  }));
};

CouchDBVersioning.prototype.updateDocuments = function (docs) {
  var self = this;
  return this.couchConnectionPromise
    .then(function () {
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
  console.log('read');
  return readTree(this.inputTree)
    .then(function (pDestDir) {
      destDir = pDestDir;
      console.log('going to update couch');
      return self.updateCouch(destDir);
    }).then(function () {
      return destDir;
    });
};

CouchDBVersioning.prototype.cleanup = function () {
  this.inputTree.cleanup();
};

module.exports = CouchDBVersioning;