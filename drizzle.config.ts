import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './electron/database/schema.ts',
  out: './electron/database/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './novelforge.db'
  }
})
