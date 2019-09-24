import { DatabaseManager, ModelQuery } from 'strapi-dbal';

class Strapi {
  db: DatabaseManager;

  query(model: string, plugin: string): ModelQuery;
}

export default function createStrapi(opts: any): Strapi;

declare global {
  const strapi: Strapi;
}
