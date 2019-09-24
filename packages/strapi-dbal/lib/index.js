'use strict';

const { createDatabaseManager } = require('./database-manager');

async function initializeDatabase(strapi) {
  const databaseManager = createDatabaseManager(strapi);
  await databaseManager.initialize();
  return databaseManager;
}

module.exports = {
  initializeDatabase,
};
