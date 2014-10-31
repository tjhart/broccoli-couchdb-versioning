'use strict';
var Writer = require('broccoli-writer')

//,  JsonConcatenator = require('broccoli-broccoli-json-concat'),
//  nano = require('nano')
  ;

CouchDBVersioning.prototype = Object.create(Writer.prototype);
CouchDBVersioning.prototype.constructor = CouchDBVersioning;
function CouchDBVersioning(inputTree, options) {
  if (!(this instanceof CouchDBVersioning)) return new CouchDBVersioning(inputTree, options);

  this.inputTree = inputTree;
  this.options = options;
}

CouchDBVersioning.prototype.write = function (readTree, destDir) {
  console.log('write', readTree, destDir);
};

CouchDBVersioning.prototype.cleanup = function () {
  console.log('cleanup', arguments);
};

module.exports = CouchDBVersioning;