import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import pg from 'pg';
import nextEnv from '@next/env';

test('Super Admin infrastructure failure stays on a retryable page without route bouncing',async({page})=>{
  let requests=0;
  await page.route('**/api/super-admin/me',route=>{
    requests++;
    return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SERVER_ERROR',error:'Service temporarily unavailable'})});
  });
  await page.goto('/super-admin/login');
  await expect(page.getByText('Platform could not be loaded')).toBeVisible({timeout:30000});
  await expect(page).toHaveURL(/\/super-admin\/login$/);
  await page.waitForTimeout(1800);
  const initialRequests=requests;
  expect(initialRequests).toBeGreaterThanOrEqual(1);
  await page.getByRole('button',{name:'Retry'}).click();
  await expect.poll(()=>requests).toBe(initialRequests+1);
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

test('a valid page session and failed workspace API do not bounce between login and dashboard',async({page,context,baseURL})=>{
  test.skip(!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname),'Local database fixture only');
  nextEnv.loadEnvConfig(process.cwd());
  test.skip(!process.env.DATABASE_URL,'Local database is unavailable');
  const {createSessionToken}=await import('../lib/auth.js');
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  const suffix=crypto.randomBytes(8).toString('hex');
  const businessId='browser_b_'+suffix,userId='browser_u_'+suffix;
  await client.connect();
  try{
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,NOW())',[userId,'Browser test',`browser-${suffix}@example.test`,'unused']);
    await client.query('INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)',[businessId,'Browser test',`browser-${suffix}`]);
    await client.query("INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,'Owner')",['browser_m_'+suffix,userId,businessId]);
    await context.addCookies([{name:'wcrm_session',value:createSessionToken({userId,businessId,role:'Owner',sessionVersion:0}),url:baseURL}]);
    let attempts=0;
    await page.route('**/api/me',route=>{attempts++;return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'AUTH_REQUIRED',error:'Sign in required.'})});});
    await page.goto('/app/dashboard');
  await expect(page.getByText('Sign in is required')).toBeVisible({timeout:30000});
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await page.waitForTimeout(1800);
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    const initialAttempts=attempts;
    await page.getByRole('button',{name:'Retry'}).click();
    await expect.poll(()=>attempts).toBeGreaterThan(initialAttempts);
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await page.unroute('**/api/me');
    await page.route('**/api/workspace/overview*',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'AUTH_REQUIRED',error:'Workspace session unavailable.'})}));
    await page.getByRole('button',{name:'Retry'}).click();
    await expect(page.getByText('Sign in is required')).toBeVisible({timeout:30000});
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await page.getByRole('button',{name:'Sign out'}).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  }finally{
    await client.query('DELETE FROM businesses WHERE id=$1',[businessId]);
    await client.query('DELETE FROM users WHERE id=$1',[userId]);
    await client.end();
  }
});
