import { expect, test } from '@playwright/test'

// E2E tests of the "Call customer" story: the display board in the waiting room.
// The board, the kiosk and the counter run in separate pages, like separate devices.
// Live updates must arrive through the event stream: the board also reloads every
// 5 seconds, so every live check waits at most 3 seconds.

const API = 'http://127.0.0.1:3001/api'
const LIVE = { timeout: 3000 }

async function resetServer() {
  const res = await fetch(`${API}/test/reset`, { method: 'POST' })
  expect(res.status).toBe(204)
}

async function issueTicket(serviceType) {
  const res = await fetch(`${API}/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceType }),
  })
  expect(res.status).toBe(201)
  return res.json()
}

async function callNext(counterId) {
  const res = await fetch(`${API}/counters/${counterId}/next`, { method: 'POST' })
  expect(res.status).toBe(200)
  return res.json()
}

// The card of one service on the board, found by the service name.
const serviceCard = (page, name) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name }) })

const queueLength = (card) => card.locator('.board-queue-length')

async function openBoard(page) {
  await page.goto('/board')
  await expect(page.getByRole('heading', { level: 1, name: 'Display board' })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(3)
}

test.beforeEach(async () => {
  await resetServer()
})

// Verifies that the board lists every service with empty queues at the start of the day.
test('board shows every service with no calls and empty queues', async ({ page }) => {
  await openBoard(page)

  for (const name of ['Payments', 'Banking', 'Shipping']) {
    const card = serviceCard(page, name)
    await expect(card).toContainText('No ticket called yet')
    await expect(queueLength(card)).toHaveText('0')
  }
})

// Verifies that the board has the same navigation bar as the other pages.
test('board has the navigation bar of the other pages', async ({ page }) => {
  await openBoard(page)

  const nav = page.getByRole('navigation')
  await expect(nav.getByRole('link', { name: 'Display board' })).toHaveClass(/active/)
  await nav.getByRole('link', { name: 'Customer' }).click()
  await expect(page).toHaveURL(/\/customer$/)
})

// Verifies that a ticket taken at the kiosk makes the queue grow on the board, without reloading.
test('ticket taken at the kiosk updates the queue on the board live', async ({ page, context }) => {
  await openBoard(page)
  const kiosk = await context.newPage()
  await kiosk.goto('/customer')

  await kiosk.getByRole('button', { name: /Banking/i }).click()
  await expect(kiosk.locator('.ticket-code')).toHaveText('B001')

  await expect(queueLength(serviceCard(page, 'Banking'))).toHaveText('1', LIVE)
  await expect(queueLength(serviceCard(page, 'Payments'))).toHaveText('0')
})

// Verifies that a customer called at a counter appears on the board with the counter number.
test('customer called at a counter appears on the board live', async ({ page, context }) => {
  await issueTicket('A')
  await issueTicket('A')
  await openBoard(page)
  const payments = serviceCard(page, 'Payments')
  await expect(queueLength(payments)).toHaveText('2')

  const counter = await context.newPage()
  await counter.goto('/officer/1')
  await counter.getByRole('button', { name: 'Next customer' }).click()
  await expect(counter.getByTestId('ticket-code')).toHaveText('A001')

  await expect(payments.locator('.board-call')).toHaveText(/A001.*Counter 1/, LIVE)
  await expect(queueLength(payments)).toHaveText('1', LIVE)
})

// Verifies that the board shows one call per counter for the same service.
test('two counters serving the same service are both shown', async ({ page }) => {
  await issueTicket('A')
  await issueTicket('A')
  await openBoard(page)

  await callNext(1)
  await callNext(2)

  const calls = serviceCard(page, 'Payments').locator('.board-call')
  await expect(calls).toHaveCount(2, LIVE)
  await expect(calls.nth(0)).toHaveText(/A001.*Counter 1/)
  await expect(calls.nth(1)).toHaveText(/A002.*Counter 2/)
})

// Verifies that a counter serving two services shows only its last call.
test('a counter is shown only next to its last call', async ({ page }) => {
  await issueTicket('A')
  await issueTicket('B')
  await issueTicket('B')
  await openBoard(page)

  expect((await callNext(2)).code).toBe('B001') // B is the longest queue
  await expect(serviceCard(page, 'Banking').locator('.board-call')).toHaveText(/B001.*Counter 2/, LIVE)

  expect((await callNext(2)).code).toBe('A001') // tie: A has the lower service time
  await expect(serviceCard(page, 'Payments').locator('.board-call')).toHaveText(/A001.*Counter 2/, LIVE)
  await expect(serviceCard(page, 'Banking')).toContainText('No ticket called yet', LIVE)
  await expect(queueLength(serviceCard(page, 'Banking'))).toHaveText('1')
})

// Verifies that every open board receives the same updates.
test('two boards open at the same time show the same call', async ({ page, context }) => {
  await issueTicket('C')
  await openBoard(page)
  const secondBoard = await context.newPage()
  await openBoard(secondBoard)

  await callNext(3)

  for (const board of [page, secondBoard]) {
    await expect(serviceCard(board, 'Shipping').locator('.board-call')).toHaveText(/C001.*Counter 3/, LIVE)
  }
})

// Verifies that the board shows the current state again after a reload.
test('board shows the same calls after a reload', async ({ page }) => {
  await issueTicket('C')
  await callNext(3)
  await openBoard(page)
  await expect(serviceCard(page, 'Shipping').locator('.board-call')).toHaveText(/C001.*Counter 3/)

  await page.reload()

  await expect(serviceCard(page, 'Shipping').locator('.board-call')).toHaveText(/C001.*Counter 3/)
  await expect(queueLength(serviceCard(page, 'Shipping'))).toHaveText('0')
})
