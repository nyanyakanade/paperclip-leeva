// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TaskUsageComparison } from "./TaskUsageComparison";
import type { TaskUsageAudit, TaskUsagePhase } from "../api/external-usage";
import { i18n } from "../i18n";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const zero={requests:0,fresh:0,cached:0,written:0,output:0,total:0};
const counts={requests:1,fresh:20,cached:80,written:5,output:10,total:115};
const phases=Object.fromEntries(["dispatch","review","coordination","mixed","execution","rework"].map(p=>[p,p==="execution"?counts:zero])) as Record<TaskUsagePhase,typeof zero>;
const sample: TaskUsageAudit={status:"ready",generatedAt:"2026-10-19T12:00:00Z",scope:"Samples only",costCents:null,singleAgentBaselineAvailable:false,
 totals:{requests:3,fresh:60,cached:240,written:15,output:30,total:345},assigned:{requests:2,fresh:40,cached:160,written:10,output:20,total:230},shared:counts,
 rows:["Argon","amcm-09"].map((executor,i)=>({id:`Task${i}`,name:executor,executor,outcome:"Reported",complete:i===0,basis:"receipts",phases,totals:counts,shared:counts,partialRange:i===0,models:["test"],firstEvent:null,lastEvent:null})),
 pools:[{reason:"Shared mixed turn",relatedTaskIds:["Task0","Task1"],totals:counts}],evidence:[]};
let container: HTMLDivElement;let root:ReturnType<typeof createRoot>;
beforeEach(()=>{container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{act(()=>root.unmount());container.remove();await i18n.changeLanguage("en");});
const render=(audit:TaskUsageAudit=sample)=>act(()=>root.render(<TaskUsageComparison audit={audit}/>));
function select(label:string,value:string){act(()=>{const el=container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}));});}
it("keeps shared pool out of task totals and explicitly flags partial lifecycles",()=>{
 render();expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Task0: 30 Fresh input + output");
 expect(container.textContent).toContain("66.7%");expect(container.textContent).toContain("Incomplete lifecycle");expect(container.textContent).toContain("Date filter clips this task");
 select("Task comparison metric","total");expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Task0: 115 All recorded Tokens");
});
it("filters executor rows without implying shared costs were allocated",()=>{
 render();select("Task executor","amcm-09");expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
 expect(container.querySelector('tbody')?.textContent).toContain("amcm-09");expect(container.textContent).toContain("shared costs stay unallocated");
});
it("combines dispatch and review into controller cost while keeping execution separate",()=>{
 if(sample.status!=="ready")throw new Error("fixture");
 const total={requests:3,fresh:60,cached:240,written:15,output:30,total:345};
 render({...sample,totals:total,assigned:total,shared:zero,pools:[],rows:[{...sample.rows[0],shared:zero,totals:total,phases:{...phases,dispatch:counts,review:counts}}]});
 expect([...container.querySelectorAll('tbody td')].map(cell=>cell.getAttribute("title"))).toEqual(["60","30","90"]);
});
it("shows missing/corrupt snapshots and localized empty ranges",async()=>{
 render({status:"invalid"});expect(container.querySelector('[role="alert"]')?.textContent).toContain("failed validation");
 render({status:"missing"});expect(container.textContent).toContain("No reviewed");
 await act(async()=>{await i18n.changeLanguage("zh-CN");});render({...sample,rows:[]});expect(container.textContent).toContain("所选日期没有");
});
