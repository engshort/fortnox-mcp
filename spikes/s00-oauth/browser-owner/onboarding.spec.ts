import {spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {test,expect} from "@playwright/test";
const root=resolve(import.meta.dirname,"../../..");
let child:ChildProcess;
let directory:string;
test.beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),"company-onboarding-browser-"));
  child=spawn(process.execPath,["--import","tsx","scripts/onboarding-fixture.ts",directory],{cwd:root,stdio:["ignore","pipe","pipe"]});
  await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error("Fixture did not start")),20_000);
    child.stdout?.on("data",data=>{if(String(data).includes("fixture ready:")){clearTimeout(timeout);resolve();}});
    child.on("exit",()=>{clearTimeout(timeout);reject(new Error("Fixture exited before ready"));});
  });
});
test.afterAll(async()=>{
  if(child?.exitCode===null){const stopped=new Promise(r=>child.once("exit",r));child.kill("SIGTERM");await stopped;}
  if(directory)await rm(directory,{recursive:true,force:true});
});
test("separate consumer and owner cookies complete A then B through actual HTTP OAuth and MCP",async({page,context},info)=>{
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);});
  page.on("console",m=>{if(m.type()==="error"||m.type()==="warning")errors.push(m.text());});
  await page.goto("http://localhost:8802/");
  await expect(page).toHaveTitle("Syntetisk konsument");
  await page.getByRole("button",{name:"Anslut företag",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Logga in",exact:true})).toBeVisible().catch(async()=>{throw new Error("Login did not render: "+JSON.stringify({errors,path:new URL(page.url()).pathname,text:await page.locator("body").innerText()}));});
  await page.getByLabel("E-post").fill("owner@example.invalid");
  await page.getByLabel("Lösenord",{exact:true}).fill("Synthetic-password-123456");
  await page.getByRole("button",{name:"Logga in",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Anslut företag",exact:true})).toBeVisible();
  const cookies=await context.cookies();
  expect(cookies.find(c=>c.name==="consumer_session")?.domain).toBe("localhost");
  expect(cookies.some(c=>c.domain==="127.0.0.1" && c.name.includes("session_token"))).toBe(true);
  async function connect(company:"A"|"B") {
    await page.getByLabel("Anslutningstyp").selectOption("user");
    await page.getByRole("button",{name:"Fortsätt till Fortnox",exact:true}).click();
    await page.getByRole("button",{name:`Godkänn Synthetic ${company}`,exact:true}).click();
    await page.getByRole("button",{name:"Fortsätt till appgodkännande",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Godkänn klient",exact:true})).toBeVisible();
    await expect(page.getByText("Synthetic consumer",{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:join(tmpdir(),`onboarding-${company}-consent-${info.project.name}.png`),fullPage:true});
    await page.getByRole("button",{name:"Godkänn begärda behörigheter till valda företag",exact:true}).click();
    await expect(page).toHaveURL(/http:\/\/localhost:8802\/companies\/[a-f0-9-]+/);
    await expect(page.getByRole("heading",{name:"Verifierat kundkort",exact:true})).toBeVisible();
    await expect(page.getByText(`Synthetic ${company}`,{exact:true})).toBeVisible();
    await expect(page.getByText("Anslutningsstatus: active",{exact:true})).toBeVisible();
  }
  await connect("A");
  await page.getByRole("link",{name:"Anslut ytterligare företag"}).click();
  await page.getByRole("button",{name:"Anslut företag",exact:true}).click();
  await connect("B");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(tmpdir(),`onboarding-result-${info.project.name}.png`),fullPage:true});
  expect(errors).toEqual([]);
});
