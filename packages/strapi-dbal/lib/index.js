'use strict';

const _ = require('lodash');

function initConnector(connector) {
  if (!connector) {
    throw new Error('Connector must be a string');
  }

  try {
    require.resolve(connector);
  } catch (error) {
    throw new Error(`Connector "${connector}" not found`);
  }

  return require(`strapi-connector-${connector}`)(strapi);
}

const createQueryManager = () => {
  const _queries = new Map();

  const toUid = (modelKey, plugin) => {
    return plugin ? `plugins::${plugin}.${modelKey}` : modelKey;
  };

  return {
    get({ modelKey, plugin }) {
      return _queries.get(toUid(modelKey, plugin));
    },
    has({ modelKey, plugin }) {
      return _queries.has(toUid(modelKey, plugin));
    },
    set({ modelKey, plugin }, query) {
      const uid = toUid(modelKey, plugin);
      _queries.set(uid, query);
      return this;
    },
  };
};

module.exports = async function({ connections }) {
  const connectors = Object.values(connections).reduce((acc, { connector }) => {
    if (!acc.has(connector)) {
      acc.set(connector, initConnector(connector));
    }

    return acc;
  }, new Map());

  for (const connector of connectors.values()) {
    await connector.initialize();
  }

  const queryManager = createQueryManager();

  return {
    connectors,
    query(entity, plugin) {
      const modelKey = entity.toLowerCase();

      if (queryManager.has({ modelKey, plugin })) {
        return queryManager.get({ modelKey, plugin });
      }

      const model =
        plugin === 'admin'
          ? _.get(strapi.admin, ['models', modelKey], undefined)
          : _.get(strapi.plugins, [plugin, 'models', modelKey]) ||
            _.get(strapi, ['models', modelKey]) ||
            _.get(strapi, ['groups', modelKey]) ||
            undefined;

      if (!model) {
        throw new Error(`The model ${modelKey} can't be found.`);
      }

      const connector = model.orm;

      if (!connector) {
        throw new Error(
          `Impossible to determine the ORM to use for the model ${modelKey}.`
        );
      }

      const query = connectors
        .get(connector)
        .queries({ model, modelKey, strapi });

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
            return mapping.bind(query, { model, modelKey });
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

          return mapping[connector].call(query, { model, modelKey });
        },
      });

      queryManager.set({ modelKey, plugin }, query);
      return query;
    },
  };
};
