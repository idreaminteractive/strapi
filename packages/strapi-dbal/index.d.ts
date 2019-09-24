export function initializeDatabase(strapi: any): Promise<DatabaseManager>;

interface ConnectionInfo {
  name: string;
}

export class DatabaseManager {
  connections: Array<ConnectionInfo>;

  initialize(): Promise<void>;
  query(model: string, plugin: string): ModelQuery;
}

export interface ModelQuery {
  find(params: object): Promise<Array<ModelValue>>;
  findOne(params: object): Promise<ModelValue>;
  count(params: object): Promise<number>;
  create(input: object): Promise<ModelValue>;
  update(params: object, input: object): Promise<ModelValue>;
  delete(params: object): Promise<ModelValue | Array<ModelValue>>;
  search(params: object): Promise<Array<ModelValue>>;
  countSearch(params: object): Promise<number>;
}

interface ModelValue {
  id: string | number;
  [propName: string]: any;
}
