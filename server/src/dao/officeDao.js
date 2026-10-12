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

// Load counters and their many-to-many service assignments in one query.
export async function getCounters(db) {
  const rows = await db.all(`
    SELECT c.id, GROUP_CONCAT(cs.service_tag) AS service_tags
    FROM counters c
    LEFT JOIN (
      SELECT counter_id, service_tag
      FROM counter_services
      ORDER BY counter_id, rowid
    ) cs ON c.id = cs.counter_id
    GROUP BY c.id
    ORDER BY c.id
  `)
  return rows.map(({ id, service_tags: serviceTags }) => ({
    id,
    services: serviceTags ? serviceTags.split(',') : [],
  }))
}

// Numeric counter ids intentionally do not match string ids.
export async function getCounter(db, id) {
  if (!Number.isInteger(id)) return undefined
  const row = await db.get(`
    SELECT c.id, GROUP_CONCAT(cs.service_tag) AS service_tags
    FROM counters c
    LEFT JOIN (
      SELECT counter_id, service_tag
      FROM counter_services
      ORDER BY counter_id, rowid
    ) cs ON c.id = cs.counter_id
    WHERE c.id = ?
    GROUP BY c.id
  `, [id])
  if (!row) return undefined
  return {
    id: row.id,
    services: row.service_tags ? row.service_tags.split(',') : [],
  }
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
          `INSERT INTO counter_services (counter_id, service_tag)
          VALUES (?, ?) ON CONFLICT DO NOTHING`,
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
