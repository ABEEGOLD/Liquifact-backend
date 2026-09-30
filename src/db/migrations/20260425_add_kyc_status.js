/**
 * Database Migration: Create kyc_records table
 *
 * Persists KYC verification results so status survives restarts.
 * One row per SME; upserted on each provider response.
 */

exports.up = async (knex) => {
  // A second runner may win the race between hasTable and createTable. Treat
  // that error as success only after confirming the table now exists; schema
  // validation below then distinguishes a completed table from partial state.
  if (!(await knex.schema.hasTable('kyc_records'))) {
    try {
      await knex.schema.createTable('kyc_records', (table) => {
        table.string('sme_id', 128).primary();
        table.string('status', 32).notNullable().defaultTo('pending');
        table.string('provider_record_id', 256).nullable();
        table.timestamp('verified_at').nullable();
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at').nullable();
      });
    } catch (error) {
      let tableExists;
      try {
        tableExists = await knex.schema.hasTable('kyc_records');
      } catch (_checkError) {
        throw error;
      }
      if (!tableExists) {
        throw error;
      }
    }
  }

  // Do not silently treat an unrelated or partially-created table as success.
  // CREATE TABLE itself is atomic on supported production/test dialects, but a
  // previous attempt may have completed it before failing while adding indexes.
  const requiredColumns = [
    'sme_id',
    'status',
    'provider_record_id',
    'verified_at',
    'updated_at',
    'deleted_at',
  ];
  const missingColumns = [];
  for (const column of requiredColumns) {
    if (!(await knex.schema.hasColumn('kyc_records', column))) {
      missingColumns.push(column);
    }
  }
  if (missingColumns.length > 0) {
    throw new Error(
      `KYC migration cannot recover kyc_records: missing required columns (${missingColumns.join(', ')})`
    );
  }

  // Keep these statements individually retryable. The production database
  // (PostgreSQL) and the supported SQLite test/development databases implement
  // CREATE INDEX IF NOT EXISTS; other failures propagate to the migration runner.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ?? ON ?? (??)',
    ['kyc_records_status_index', 'kyc_records', 'status']
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ?? ON ?? (??)',
    ['kyc_records_deleted_at_index', 'kyc_records', 'deleted_at']
  );
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('kyc_records');
};
