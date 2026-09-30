import { expect, test } from '@playwright/test';

test('Super Admin infrastructure failure stays on a retryable page without route bouncing',async({page})=>{
  let requests=0;
  await page.route('**/api/super-admin/me',route=>{
    requests++;
    return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SERVER_ERROR',error:'Service temporarily unavailable'})});
  });
  await page.goto('/super-admin/login');
  await expect(page.getByText('Platform could not be loaded')).toBeVisible();
  await expect(page).toHaveURL(/\/super-admin\/login$/);
  await page.waitForTimeout(1800);
  expect(requests).toBe(1);
  await page.getByRole('button',{name:'Retry'}).click();
  await expect.poll(()=>requests).toBe(2);
  await expect(page).toHaveURL(/\/super-admin\/login$/);
});

test('an invalid workspace cookie reaches login once and stays there',async({page,context,baseURL})=>{
  await context.addCookies([{name:'wcrm_session',value:'invalid-session',url:baseURL}]);
  await page.goto('/app/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page).toHaveURL(/\/login$/);
});
