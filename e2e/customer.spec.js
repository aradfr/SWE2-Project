import { expect, test } from '@playwright/test'

async function resetServer() {
  await fetch('http://127.0.0.1:3001/api/test/reset', { method: 'POST' })
}

test.beforeEach(async () => {
  await resetServer()
})

// Verifies that a customer can open the kiosk and see the available services.
test('customer can open the kiosk and choose a service', async ({ page }) => {
  await page.goto('/customer')

  await expect(page.getByRole('heading', { name: 'Customer' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Customer' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Payments/i })).toBeVisible()
})

// Verifies that selecting a service issues a ticket with the expected code and service.
test('customer receives a ticket code for the selected service', async ({ page }) => {
  await page.goto('/customer')

  await page.getByRole('button', { name: /Payments/i }).click()

  await expect(page.getByText('Ticket issued')).toBeVisible()
  await expect(page.locator('.ticket-code')).toHaveText(/A\d{3}/)
  await expect(page.getByText('Service:')).toContainText('Payments')
})
