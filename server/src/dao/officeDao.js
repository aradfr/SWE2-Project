// Read configured service types in their insertion order.
export async function getServices(db) {
  const rows = await db.all(
    'SELECT tag, name, service_time AS serviceTime FROM services ORDER BY rowid',
  )
  return rows
}

// Return one service or undefined when the tag is not configured.
export async function getService(db, tag) {
  return db.get(
    'SELECT tag, name, service_time AS serviceTime FROM services WHERE tag = ?',
    [tag],
  )
}

// Load counters and their many-to-many service assignments.
export async function getCounters(db) {
  const counters = await db.all('SELECT id FROM counters ORDER BY id')
  for (const counter of counters) {
    const services = await db.all(
      'SELECT service_tag AS tag FROM counter_services WHERE counter_id = ? ORDER BY rowid',
      [counter.id],
    )
    counter.services = services.map(({ tag }) => tag)
  }
  return counters
}

// Numeric counter ids intentionally do not match string ids.
export async function getCounter(db, id) {
  if (!Number.isInteger(id)) return undefined
  const counter = await db.get('SELECT id FROM counters WHERE id = ?', [id])
  if (!counter) return undefined
  const services = await db.all(
    'SELECT service_tag AS tag FROM counter_services WHERE counter_id = ? ORDER BY rowid',
    [id],
  )
  counter.services = services.map(({ tag }) => tag)
  return counter
}

// Seed configuration without duplicating rows when the application restarts.
export async function seedOffice(db, services, counters) {
  // Keep services, counters and relationships consistent as one unit.
  await db.run('BEGIN')
  try {
    for (const service of services) {
      await db.run(
        `INSERT INTO services (tag, name, service_time) VALUES (?, ?, ?)
         ON CONFLICT(tag) DO UPDATE SET name = excluded.name, service_time = excluded.service_time`,
        [service.tag, service.name, service.serviceTime],
      )
    }

    for (const counter of counters) {
      await db.run('INSERT INTO counters (id) VALUES (?) ON CONFLICT(id) DO NOTHING', [counter.id])
      for (const tag of counter.services) {
        await db.run(
          'INSERT INTO counter_services (counter_id, service_tag) VALUES (?, ?) ON CONFLICT DO NOTHING',
          [counter.id, tag],
        )
      }
    }
    await db.run('COMMIT')
  } catch (error) {
    await db.run('ROLLBACK')
    throw error
  }
}