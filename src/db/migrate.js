const fs = require('fs');
const path = require('path');
const pool = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

const ensureMigrationsTable = async () => {
  const migrationTablePath = path.join(MIGRATIONS_DIR, '000_create_migrations_table.sql');
  const sql = fs.readFileSync(migrationTablePath, 'utf8');
  await pool.query(sql);
};

const getPendingMigrations = async () => {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f !== '000_create_migrations_table.sql')
    .sort();

  const result = await pool.query('SELECT version FROM schema_migrations');
  const executedVersions = new Set(result.rows.map(r => r.version));

  return files.filter(f => !executedVersions.has(f.split('_')[0]));
};

const getExecutedMigrations = async () => {
  const result = await pool.query(
    'SELECT version, name, executed_at FROM schema_migrations ORDER BY version DESC'
  );
  return result.rows;
};

const parseMigration = (content) => {
  const upMatch = content.match(/-- UP\n([\s\S]*?)(?=-- DOWN|$)/);
  const downMatch = content.match(/-- DOWN\n([\s\S]*?)$/);

  return {
    up: upMatch ? upMatch[1].trim() : content.trim(),
    down: downMatch ? downMatch[1].trim() : null,
  };
};

const runMigration = async (filename, direction = 'up') => {
  const version = filename.split('_')[0];
  const name = filename.replace('.sql', '').substring(4);
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf8');
  const { up, down } = parseMigration(content);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (direction === 'up') {
      console.log(`Running migration: ${filename}`);
      await client.query(up);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, name]
      );
      console.log(`✓ Migrated: ${filename}`);
    } else if (direction === 'down') {
      if (!down) {
        throw new Error(`No DOWN migration found for ${filename}`);
      }
      console.log(`Rolling back migration: ${filename}`);
      await client.query(down);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      console.log(`✓ Rolled back: ${filename}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`✗ Failed: ${filename}`);
    throw error;
  } finally {
    client.release();
  }
};

const migrate = async () => {
  try {
    await ensureMigrationsTable();
    const pending = await getPendingMigrations();

    if (pending.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Found ${pending.length} pending migration(s)`);

    for (const file of pending) {
      await runMigration(file, 'up');
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
};

const rollback = async (steps = 1) => {
  try {
    await ensureMigrationsTable();
    const executed = await getExecutedMigrations();

    if (executed.length === 0) {
      console.log('No migrations to rollback');
      return;
    }

    const toRollback = executed.slice(0, steps);
    console.log(`Rolling back ${toRollback.length} migration(s)`);

    for (const migration of toRollback) {
      const files = fs.readdirSync(MIGRATIONS_DIR);
      const file = files.find(f => f.startsWith(migration.version));

      if (!file) {
        console.error(`Migration file not found for version ${migration.version}`);
        continue;
      }

      await runMigration(file, 'down');
    }

    console.log('Rollback completed successfully');
  } catch (error) {
    console.error('Rollback failed:', error.message);
    process.exit(1);
  }
};

const status = async () => {
  try {
    await ensureMigrationsTable();

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') && f !== '000_create_migrations_table.sql')
      .sort();

    const result = await pool.query(
      'SELECT version, executed_at FROM schema_migrations ORDER BY version'
    );
    const executedMap = new Map(result.rows.map(r => [r.version, r.executed_at]));

    const useColor = process.stdout.isTTY;
    const green = s => useColor ? `\x1b[32m${s}\x1b[0m` : s;
    const gray  = s => useColor ? `\x1b[90m${s}\x1b[0m` : s;

    const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
    const visibleLength = s => stripAnsi(s).length;

    const rows = files.map(file => {
      const version = file.split('_')[0];
      const name = file.replace('.sql', '').substring(4);
      const executed = executedMap.get(version);

      return {
        status: executed ? green('✓ UP') : gray('· PENDING'),
        version,
        migration: executed
          ? `${name} (${new Date(executed).toISOString().split('T')[0]})`
          : name
      };
    });

    const colWidths = {
      status: Math.max(6, ...rows.map(r => visibleLength(r.status))),
      version: Math.max(7, ...rows.map(r => r.version.length)),
      migration: Math.max(9, ...rows.map(r => r.migration.length)),
    };

    const line = (l, m, r) =>
      `${l}${'─'.repeat(colWidths.status + 2)}${m}` +
      `${'─'.repeat(colWidths.version + 2)}${m}` +
      `${'─'.repeat(colWidths.migration + 2)}${r}`;

    console.log(`Database Migration Status`);
    console.log(line('┌', '┬', '┐'));
    console.log(
      `│ ${'Status'.padEnd(colWidths.status)} │ ` +
      `${'Version'.padEnd(colWidths.version)} │ ` +
      `${'Migration'.padEnd(colWidths.migration)} │`
    );
    console.log(line('├', '┼', '┤'));

    for (const r of rows) {
      console.log(
        `│ ${r.status}${' '.repeat(colWidths.status - visibleLength(r.status))} │ ` +
        `${r.version.padEnd(colWidths.version)} │ ` +
        `${r.migration.padEnd(colWidths.migration)} │`
      );
    }

    console.log(line('└', '┴', '┘'));
    console.log('');
  } catch (error) {
    console.error('✗ Failed to get status:', error.message);
    process.exit(1);
  }
};

const reset = async () => {
  try {
    await ensureMigrationsTable();
    const executed = await getExecutedMigrations();

    if (executed.length === 0) {
      console.log('Database is already empty');
      return;
    }

    console.log(`Rolling back all ${executed.length} migration(s)`);
    await rollback(executed.length);
  } catch (error) {
    console.error('Reset failed:', error.message);
    process.exit(1);
  }
};

const create = async (name) => {
  if (!name) {
    console.error('Please provide a migration name');
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f !== '000_create_migrations_table.sql');

  const lastVersion = files.length > 0
    ? Math.max(...files.map(f => parseInt(f.split('_')[0])))
    : 0;

  const newVersion = String(lastVersion + 1).padStart(3, '0');
  const filename = `${newVersion}_${name.replace(/\s+/g, '_').toLowerCase()}.sql`;
  const filePath = path.join(MIGRATIONS_DIR, filename);

  const template = `-- UP


-- DOWN

`;

  fs.writeFileSync(filePath, template);
  console.log(`Created migration: ${filename}`);
};

module.exports = {
  migrate,
  rollback,
  status,
  reset,
  create,
};

if (require.main === module) {
  const command = process.argv[2];
  const arg = process.argv[3];

  (async () => {
    try {
      switch (command) {
        case 'migrate':
        case 'up':
          await migrate();
          break;
        case 'rollback':
        case 'down':
          await rollback(arg ? parseInt(arg) : 1);
          break;
        case 'status':
          await status();
          break;
        case 'reset':
          await reset();
          break;
        case 'create':
          await create(arg);
          process.exit(0);
          break;
        default:
          console.log(`
Usage: node src/db/migrate.js <command> [options]

Commands:
  migrate, up              Run pending migrations
  rollback, down [steps]   Rollback migrations (default: 1)
  status                   Show migration status
  reset                    Rollback all migrations
  create <name>            Create new migration file

Examples:
  node src/db/migrate.js migrate
  node src/db/migrate.js rollback 2
  node src/db/migrate.js status
  node src/db/migrate.js create add_user_roles
          `);
          process.exit(1);
      }

      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error('Error:', error);
      await pool.end();
      process.exit(1);
    }
  })();
}