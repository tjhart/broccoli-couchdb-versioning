# Broccoli CouchDB Versioning

A simple tool for defining CouchDB Design documents with files, and using Broccoli to 
keep them in sync with the database

## Installation

```bash
npm install --save broccoli-couchdb-versioning
```

## Getting Started

```javascript
//Brocfile.js
var couchDBVersioning = require('broccoli-couchdb-versioning');

module.exports = couchdBVersioning('couchdb', {
  url:'http://localhost:5984/db',
  username:admin_username,
  password:admin_password,
  initDesign:true
});
```
* `couchdb` is the path to where your couchdb assets are, or should be stored
* `url` is the url to your database
* `username` is an admin usename with view read and update rights
* `password` is their password
* `initDesign` should be set to `true` if you want to have `broccoli-couchdb-versioning` load
the existing contents of the CouchDB database to your file system on startup. **NOTE** only do this
once. I recommend you use this setting, execute `broccoli build dist`, and then remove it

Once you have captured your CouchDB Design documents, you can keep `broccoli serve` running during
a development session. Once you update a file, it's associated design document will get updated automatically 

## TODO
* Handle design doc deletes
* Manage other documents besides design documents

## Things to consider
* Synchronization is only one way - from the file system to the server. This tool assumes
that the file system is always the expert. 
* Deleting a design document locally will not reflect to the server. Inserts and updates will work
* `broccoli-couchdb-versioning` adds a `revTimestamp` field to each design document. It's this field that is used to 
determine if a document should be updated
* broccoli-couchdb-versioning will refuse to update a document if the server revTimestamp is greater than the last
recorded revision. If this happens, double check with your source control or someone else in your team. 
`broccoli-couchdb-versioning` will continue to work for other documents.

## Contribute

Check out
[broccoli-couchdb-versioning](https://github.com/tjhart/broccoli-couchdb-versioning).

## TODO

* Determine when a document has been deleted, and remove it from the other store
* Synchronize other documents too, not just design documents
* Improve versioning. We're not quite ready for prime time.

## License

[MIT license](LICENSE.md).

