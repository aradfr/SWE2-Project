import { expect, test } from '@playwright/test'

async function resetServer() {
  const res = await fetch('http://127.0.0.1:3001/api/test/reset', { method: 'POST' })
  expect(res.status).toBe(204)
}

test.beforeEach(async () => {
  await resetServer()
})

// Verifies that an officer can open the counter selection page.
test('officer can open the counter selection page', async ({ page }) => {
  await page.goto('/officer')

  await expect(page.getByRole('heading', { name: 'Officer' })).toBeVisible()
  await expect(page.getByText('Select your counter')).toBeVisible()
})

// Verifies that an officer can call a waiting customer and see the ticket details.
test('officer calls the next customer for the selected counter', async ({ page }) => {
  await fetch('http://127.0.0.1:3001/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceType: 'A' }),
  })

  await page.goto('/officer/1')
  await page.getByRole('button', { name: 'Next customer' }).click()

  await expect(page.locator('[data-testid="ticket-code"]')).toHaveText('A001')
  await expect(page.locator('[data-testid="ticket-service"]')).toHaveText('Payments')
})

// Verifies that the counter shows a warning when its queue is empty.
test('officer sees a warning when no customer is waiting', async ({ page }) => {
  await page.goto('/officer/1')

  await page.getByRole('button', { name: 'Next customer' }).click()

  await expect(page.getByText('No customers waiting')).toBeVisible()
})
