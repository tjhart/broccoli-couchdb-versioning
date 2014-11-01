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
  password:admin_password //save to use process.env.COUCHDB_ADMIN_PASSWORD,
  initDesign:true
});
```
* "couchdb" is the path to where your couchdb assets are, or should be stored
* `url` is the url to your database
* username is an admin usename with view read and update rights
* password is their password
* initDesign should be set to `true` if you want to have `broccoli-couchdb-versioning` load
the existing contents of the CouchDB database to your file system on startup. **NOTE** only do this
once. I recommend you use this setting, execute `broccoli build dist`, and then remove it

Once you have captured your CouchDB Design documents, you can keep `broccoli serve` running during
a development session. Once you update a file, it's associated design document will get updated automatically 

# Things to consider
* Modifying _rev.txt or _id.txt is silly. Don't do it.
* Synchronization is only one way for now - from the file system to the server.

## Contribute

Check out
[broccoli-couchdb-versioning](https://github.com/tjhart/broccoli-couchdb-versioning).

## TODO

* Change behavior when run in production. Document revisions get out of sync
between environments, so force a prod update
* Determine when a document has been deleted, and remove it from the other store
* Synchronize other documents too, not just design documents
* Implement full two way synchronization and conflict management

## License

[MIT license](LICENSE.md).

