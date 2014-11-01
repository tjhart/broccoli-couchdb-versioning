var couchVersioner = require('../index');

module.exports = couchVersioner('design/', {
  url: 'http://localhost:5984/test',
  username: 'tjhart',
  password: 'icthus'
});