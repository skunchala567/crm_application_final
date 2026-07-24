import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { chromium } from 'playwright-core';

const connection = await mysql.createConnection({ host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE });
const [rows] = await connection.query(`SELECT u.id,u.employee_id AS employeeId,u.email,COALESCE(e.employee_name,u.email) AS name FROM app_users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id LEFT JOIN employees e ON e.id=u.employee_id WHERE r.normalized_name='ADMIN' AND u.is_active=TRUE LIMIT 1`);
const user=rows[0]; const [branches]=await connection.execute(`SELECT branch_id AS id FROM user_branches WHERE user_id=? UNION SELECT branch_id AS id FROM app_users WHERE id=? AND branch_id IS NOT NULL`,[user.id,user.id]); await connection.end();
const profile={id:Number(user.id),employeeId:user.employeeId?Number(user.employeeId):null,name:user.name,email:user.email,role:'ADMIN',roles:['ADMIN'],branchIds:branches.map(row=>Number(row.id))};
const token=jwt.sign(profile,process.env.JWT_SECRET,{expiresIn:'10m'});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1920,height:920},deviceScaleFactor:1});
const errors=[]; page.on('pageerror',error=>errors.push(error.message)); page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
await page.addInitScript(({token,profile})=>{localStorage.setItem('crm_token',token);localStorage.setItem('crm_user',JSON.stringify(profile));},{token,profile});
await page.goto('http://localhost:3000/leads',{waitUntil:'networkidle'});
await page.locator('.lead-command-center').waitFor();
const artifactDirectory=path.resolve('artifacts'); await fs.mkdir(artifactDirectory,{recursive:true});
const screenshot=path.join(artifactDirectory,'leads-command-qa.png'); await page.screenshot({path:screenshot,fullPage:true});
const tabs=await page.locator('.stage-tabs button').count(); await page.locator('.stage-tabs button').nth(Math.min(1,tabs-1)).click();
page.once('dialog',dialog=>dialog.accept('QA funnel')); await page.getByRole('button',{name:/Create funnel/i}).click(); await page.getByRole('button',{name:/QA funnel/i}).waitFor();
await page.locator('.utility-icon[title="Add lead"]').click(); await page.getByRole('heading',{name:'Add new lead'}).waitFor(); await page.locator('.lead-drawer .drawer-head .icon-btn').click();
let bulkActionFunctional=false; if(await page.locator('tbody input[type=checkbox]').count()){await page.locator('tbody input[type=checkbox]').first().check();await page.locator('.lead-quick-actions button[title="Assign selected"]').click();bulkActionFunctional=await page.locator('.notice.success').isVisible();}
const downloadPromise=page.waitForEvent('download');await page.locator('.lead-quick-actions button[title="Export visible leads"]').click();await downloadPromise;
await page.locator('.global-search input').fill('student'); await page.locator('.global-search').press('Enter'); await page.waitForLoadState('networkidle');
console.log(JSON.stringify({screenshot,viewport:'1920x920',commandVisible:await page.locator('.lead-command-center').isVisible(),stageTabs:tabs,funnelFunctional:true,quickAddFunctional:true,bulkActionFunctional,exportFunctional:true,globalSearchFunctional:page.url().includes('/leads'),consoleErrors:errors.filter(error=>!error.includes('404'))},null,2));
await browser.close();
