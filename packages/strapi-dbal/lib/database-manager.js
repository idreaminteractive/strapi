'use strict';

const _ = require('lodash');

const requireConnector = require('./require-connector');

function findModel(name, plugin) {
  if (plugin === 'admin') {
    return _.get(strapi.admin, ['models', name]);
  }

  return (
    _.get(strapi.plugins, [plugin, 'models', name]) ||
    _.get(strapi, ['models', name]) ||
    _.get(strapi, ['groups', name])
  );
}

class DatabaseManager {
  constructor(strapi) {
    this.strapi = strapi;

    // throw if connections and schemas aren't arrays
    this.initialized = false;
    this.queries = new Map();
    this.connectors = new Map();
  }

  async initialize() {
    if (this.initialized === true) {
      throw new Error('Database manager already initialized');
    }

    this.initialized = true;

    const connectorsToInitialize = [];
    for (const connection of Object.values(this.strapi.config.connections)) {
      const { connector } = connection;
      if (!connectorsToInitialize.includes(connector)) {
        connectorsToInitialize.push(connector);
      }
    }

    for (const connectorToInitialize of connectorsToInitialize) {
      const connector = requireConnector(connectorToInitialize)(strapi);

      this.connectors.set(connectorToInitialize, connector);

      await connector.initialize();
    }
  }

  query(entity, plugin) {
    if (!entity) {
      throw new Error(`argument entity is required`);
    }

    const normalizedName = entity.toLowerCase();

    const model = findModel(normalizedName, plugin);

    if (!model) {
      throw new Error(`The model ${entity} can't be found.`);
    }

    const { uid } = model;

    if (this.queries.has(uid)) {
      return this.queries.get(uid);
    }

    const connector = model.orm;

    if (!connector) {
      throw new Error(
        `Impossible to determine the ORM to use for the model ${entity}.`
      );
    }

    const query = this.connectors
      .get(connector)
      .queries({ model, modelKey: normalizedName, strapi });

    Object.assign(query, {
      orm: connector,
      primaryKey: model.primaryKey,
      associations: model.associations,
    });

    // custom queries made easy
    Object.assign(query, {
      get model() {
        return model;
      },
      custom(mapping) {
        if (typeof mapping === 'function') {
          return mapping.bind(query, { model, modelKey: normalizedName });
        }

        if (!mapping[connector]) {
          throw new Error(`Missing mapping for orm ${connector}`);
        }

        if (typeof mapping[connector] !== 'function') {
          throw new Error(
            `Custom queries must be functions received ${typeof mapping[
              connector
            ]}`
          );
        }

        return mapping[connector].call(query, { model, normalizedName });
      },
    });

    this.queries.set(uid, query);
    return query;
  }
}

function createDatabaseManager(strapi) {
  return new DatabaseManager(strapi);
}

module.exports = {
  createDatabaseManager,
};
