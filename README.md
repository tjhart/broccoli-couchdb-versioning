# Broccoli CouchDB Versioning

A [Broccoli](https://github.com/broccolijs/broccoli) plugin for defining CouchDB Design documents with files, and using 
Broccoli to keep them in sync with the database

## Installation

```bash
npm install --save broccoli-couchdb-versioning
```

## Getting Started

The input tree is expected to have the following structure:

```
couchdb
|--- _design
+--- docs #(optional)
```

The `_design` directory keeps your design documents, and the `docs` directory keeps any lookup data
you want in your database.

To facilitate development, the contents of the `_design` directory is 'unrolled' JSON. A typical example:

```
_design
|--- myDesignDocument
|    |--- _rev.txt #<some rev value>
|    |--- language.txt #javascript
|    +--- views
|         +--- someViewName
|              |--- map.js #the map function for this view
|              +--- reduce.js #the optional reduce for this view
+--- myOtherDesignDocument
     |--- _rev.txt #<some rev value>
     |--- language.txt #javascript
     +--- views
          +--- someOtherViewName
               +--- map.js #the map function for this view
```

This makes it easier to develop and test specific map/reduce functions. CouchDBVersioning rolls this structure up into
appropriately formatted design documents when updating CouchDB.
 
 The `docs` directory is expected to be flat - one file per CouchDB Document. Each file is expected to be valid JSON.
 The file name will be the name of the document in CouchDB:
 
 ```
 docs
 +--- myDoc.json #{"foo":"bar"}
 ```
 
 results in a CouchDB Document:
 ```javascript
 {
    "foo":"bar",
    "_id":"myDoc",
    "_rev":"some revision string"
 }
 ```

## Configuration

```javascript
//Brocfile.js
var couchDBVersioning = require('broccoli-couchdb-versioning');

module.exports = couchdBVersioning('couchdb', {
  url:'http://localhost:5984/db',
  username:admin_username,
  password:admin_password,
  initDesign:true, //optional. Useful for initial setup
  manageDocs:true //optional. See documentation
});
```

* `couchdb` is the path to where your couchdb assets are, or should be stored
* `url` is the url to your database
* `username` is an admin usename with view read and update rights
* `password` is their password
* `initDesign` should be set to `true` if you want to have `broccoli-couchdb-versioning` load
the existing CouchDB design documents database to your file system on startup. **NOTE** only do this
once. Optional. Defaults to false. 
* `manageDocs` whether or not the `docs` directory should be monitored. Optional. Defaults to true. 

`initDesign` is useful to capture existing design documents. Set the option to true, execute `broccoli build dist`, and 
then remove it. Leaving this value set could result local changes being over-ridden when CouchDB Versioning starts.

`manageDocs` is useful when you have static documents to manage. If set to `true`, then the `docs` subdirectory 
must exist, and contain one or more JSON files. Setting `manageDocs` to `false` will speed up builds when you're 
actively developing views.

You can also define your configuration dynamically. One example:

```javascript
//Brocfile.js
var couchDBVersioning = require('broccoli-couchdb-versioning');

// was broccoli executed as 'broccoli build ...'?
var isBuild = process.argv.indexOf('build') > -1;

module.exports = couchdBVersioning('couchdb', {
  url:'http://localhost:5984/db',
  username:admin_username,
  password:admin_password,
  manageDocs:isBuild //only manage documents during builds, not 'broccoli serve'
});

```

In this configuration, the developer can use `broccoli serve` in cases where
design docs are under development, but static docs are stable. `broccoli build` will still manage static documents 

Once you have captured your CouchDB Design documents, you can keep `broccoli serve` running during
a development session. When you update a file, it's associated design document will get updated automatically. 

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
* Determine when a design document has been deleted, and remove it from the other store

## License

[MIT license](LICENSE.md).

