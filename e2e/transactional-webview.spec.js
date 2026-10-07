import {expect,test} from '@playwright/test';
import crypto from 'node:crypto';
import nextEnv from '@next/env';
import {enterSystemContext,query} from '../lib/db.js';

nextEnv.loadEnvConfig(process.cwd());

test('customer can complete a contact-bound WhatsApp order page without layout overflow',async({page},testInfo)=>{
  test.setTimeout(120000);
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='wb_'+suffix,account='wa_'+suffix,phone='wap_'+suffix,contact='c_'+suffix,flow='waf_'+suffix,resource='frr_'+suffix,view='wv_'+suffix,session='frs_'+suffix,invite='wvi_'+suffix,token=crypto.randomBytes(32).toString('hex');
  try{
    await query('INSERT INTO businesses(id,name,slug,review_access) VALUES($1,$2,$1,TRUE)',[business,'Browser test business']);
    await query("INSERT INTO whatsapp_accounts(id,business_id,waba_id,status) VALUES($1,$2,$3,'connected')",[account,business,'1'+BigInt('0x'+suffix).toString()]);
    await query("INSERT INTO whatsapp_phone_numbers(id,business_id,whatsapp_account_id,phone_number_id,display_phone_number,registration_state) VALUES($1,$2,$3,$4,'+1 555 000 1234','registered')",[phone,business,account,'2'+BigInt('0x'+suffix).toString()]);
    await query('INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,$3,$4)',[contact,business,'Customer','15550001111']);
    await query("INSERT INTO whatsapp_native_flows(id,business_id,whatsapp_account_id,name,status,endpoint_phone_id) VALUES($1,$2,$3,'Order flow','published',$4)",[flow,business,account,phone]);
    await query("INSERT INTO flow_runtime_resources(id,business_id,kind,title,capacity,catalog_id,retailer_id,unit_price,currency) VALUES($1,$2,'product','Sample item',5,'12345','sku-1',12.50,'USD')",[resource,business]);
    const config={enabled:true,mode:'order',resourceIds:[resource],initialScreen:'CHOOSE',reviewScreen:'REVIEW',allowedActions:['list','reserve','confirm','cancel'],holdMinutes:10,reviewRoutes:[]};
    await query('INSERT INTO flow_runtime_configs(flow_id,business_id,config) VALUES($1,$2,$3)',[flow,business,JSON.stringify(config)]);
    await query("INSERT INTO whatsapp_webviews(id,business_id,phone_id,flow_id,title,description,button_label,prefilled_message,expires_hours,enabled) VALUES($1,$2,$3,$4,'Order page','Choose a product','Open order','Choose your product',1,TRUE)",[view,business,phone,flow]);
    const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
    await query("INSERT INTO flow_runtime_sessions(id,business_id,flow_id,phone_id,contact_id,token_hash,revision,screen,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,'CHOOSE',NOW()+INTERVAL '1 hour')",[session,business,flow,phone,contact,tokenHash]);
    await query("INSERT INTO whatsapp_webview_invites(id,business_id,webview_id,runtime_session_id,contact_id,request_id,fingerprint,token_hash,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'fixture',$7,'sent',NOW()+INTERVAL '1 hour')",[invite,business,view,session,contact,'open_'+suffix,tokenHash]);
    await page.goto(`/w/${view}?session=${token}`);
    await expect(page.getByText('Sample item')).toBeVisible();
    await expect(page).not.toHaveURL(/session=/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)).toBe(false);
    await page.screenshot({path:testInfo.outputPath('customer-webview.png'),fullPage:true});
    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button',{name:'Continue'}).click();
    await expect(page.getByRole('heading',{name:'Review order'})).toBeVisible();
    await page.getByRole('button',{name:'Confirm'}).click();
    await expect(page.getByRole('heading',{name:'Order recorded'})).toBeVisible();
    enterSystemContext();
    const result=await query('SELECT payment_status,total_amount FROM whatsapp_orders WHERE business_id=$1',[business]);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].payment_status).toBe('unpaid');
    expect(Number(result.rows[0].total_amount)).toBe(25);
  }finally{
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1',[business]);
  }
});
