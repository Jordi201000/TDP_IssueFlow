export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  db: {
    host: string;
    port: number;
    user: string;
    pass: string;
    name: string;
  };
  jwt: {
    secret: string;
    ttlSeconds: number;
  };
}

export const configuration = (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    user: process.env.DB_USER ?? 'issueflow',
    pass: process.env.DB_PASS ?? 'issueflow',
    name: process.env.DB_NAME ?? 'issueflow',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me-in-prod',
    ttlSeconds: parseInt(process.env.JWT_TTL_SECONDS ?? '3600', 10),
  },
});
