/**
 * Database Migration: Create kyc_records table
 *
 * Persists KYC verification results so status survives restarts.
 * One row per SME; upserted on each provider response.
 */

exports.up = async (knex) => {
  // Use atomic IF NOT EXISTS DDL so concurrent deploy/test invocations do not
  // race on the primary table. Keep indexes separate and idempotent: if an
  // index creation fails after the table exists, a retry completes the schema.
  await knex.schema.createTableIfNotExists('kyc_records', (table) => {
    table.string('sme_id', 128).primary();
    table.string('status', 32).notNullable().defaultTo('pending');
    table.string('provider_record_id', 256).nullable();
    table.timestamp('verified_at').nullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('deleted_at').nullable();
  });

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ?? ON ?? (??)',
    ['kyc_records_status_index', 'kyc_records', 'status'],
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ?? ON ?? (??)',
    ['kyc_records_deleted_at_index', 'kyc_records', 'deleted_at'],
  );
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('kyc_records');
};
