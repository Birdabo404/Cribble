import { test, expect } from '@playwright/test'

test.describe('core routes smoke', () => {
  test('homepage loads with cribble branding', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'cribble.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible()
  })

  test('login page shows GitHub sign-in', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible()
  })

  test('leaderboard page renders', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page.getByLabel('GLOBAL LEADERBOARD')).toBeVisible()
  })

  test('welcome page has skip link', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible()
  })
})
