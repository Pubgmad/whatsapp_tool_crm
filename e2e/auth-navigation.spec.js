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

test('a verified owner signs in and reaches the dashboard',async({page,context,baseURL})=>{
  test.skip(!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname),'Local database fixture only');
  nextEnv.loadEnvConfig(process.cwd());
  test.skip(!process.env.DATABASE_URL,'Local database is unavailable');
  const {hashPassword}=await import('../lib/auth.js');
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  const suffix=crypto.randomBytes(8).toString('hex');
  const businessId='login_b_'+suffix,userId='login_u_'+suffix;
  const email=`login-${suffix}@example.test`,password=crypto.randomBytes(24).toString('base64url');
  await client.connect();
  try{
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,NOW())',[userId,'Login test',email,hashPassword(password)]);
    await client.query('INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)',[businessId,'Login test',`login-${suffix}`]);
    await client.query("INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,'Owner')",['login_m_'+suffix,userId,businessId]);
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Sign in'}).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/,{timeout:30000});
    await expect(page.locator('section.workspace')).toBeVisible();
    const session=(await context.cookies()).find(cookie=>cookie.name==='wcrm_session');
    expect(session?.httpOnly).toBe(true);
    await expect.poll(async()=> (await page.request.get('/api/me')).status()).toBe(200);
    await page.addInitScript(()=>{
      window.FB={
        init(){},
        login(callback){
          if(callback.constructor.name!=='Function')throw new Error('Expression is of type asyncfunction, not function');
          callback({status:'not_authorized'});
        }
      };
    });
    await page.route('**/api/workspace/setup*',async route=>{
      const response=await route.fetch();
      const state=await response.json();
      state.meta.embeddedSignupAvailable=true;
      await route.fulfill({response,json:state});
    });
    await page.route('**/api/meta/embedded-signup/config*',route=>route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({appId:'123',configId:'456',graphVersion:'v26.0'})
    }));
    await page.goto('/app/settings/whatsapp');
    await expect(page.getByRole('button',{name:'Cloud API number'})).toBeVisible();
    await page.getByRole('button',{name:'Cloud API number'}).click();
    await expect(page.getByRole('alert').filter({hasText:'Meta did not authorize this app.'})).toBeVisible();
  }finally{
    await client.query('DELETE FROM businesses WHERE id=$1',[businessId]);
    await client.query('DELETE FROM users WHERE id=$1',[userId]);
    await client.end();
  }
});

test('signup submits account details and shows the verification step',async({page})=>{
  let submitted;
  await page.route('**/api/auth/register',async route=>{
    submitted=route.request().postDataJSON();
    await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,verificationRequired:true})});
  });
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Signup browser test');
  await page.getByLabel('Business name').fill('Signup browser workspace');
  await page.getByLabel('Email').fill('browser-signup@example.test');
  await page.getByLabel('Password',{exact:true}).fill('TestingPassword-Only-123');
  await page.getByLabel('Confirm password').fill('TestingPassword-Only-123');
  await page.getByRole('button',{name:'Create account'}).click();
  await expect(page.getByText('Check your email and verify the account before signing in.')).toBeVisible();
  expect(submitted.email).toBe('browser-signup@example.test');
  expect(submitted.businessName).toBe('Signup browser workspace');
});

test('a rejected workspace session returns to sign in once without bouncing',async({page,context,baseURL})=>{
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
    await expect(page).toHaveURL(/\/login\?reauth=1$/,{timeout:30000});
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
    await page.waitForTimeout(1800);
    await expect(page).toHaveURL(/\/login\?reauth=1$/);
    expect(attempts).toBeGreaterThanOrEqual(1);
  }finally{
    await client.query('DELETE FROM businesses WHERE id=$1',[businessId]);
    await client.query('DELETE FROM users WHERE id=$1',[userId]);
    await client.end();
  }
});
