import {describe,it,expect} from 'vitest';
import type {CrmSnapshot} from '@/hooks/useCrmSnapshot';
import {copilotAnswer} from './copilot-evidence';
const now=new Date('2026-09-06T12:00:00Z');
function snapshot():CrmSnapshot{return {contacts:[],companies:[],deals:[],activities:[],members:[],riskRules:[],pipelines:[],stages:[]};}
describe('copilot evidence',()=>{
 it('does not equate no rule results with everything resolved',()=>{const answer=copilotAnswer('O que priorizar hoje?',snapshot(),now);expect(answer.summary).toContain('não significa');expect(answer.unknown).toHaveLength(2);});
 it('never invents evidence for a name that is absent',()=>{const answer=copilotAnswer('Empresa desconhecida',snapshot(),now);expect(answer.evidence).toEqual([]);expect(answer.summary).toContain('Não encontrei');});
 it('links suggestions to concrete records and never changes data',()=>{const data=snapshot();data.contacts=[{id:'person-a',org_id:'org',first_name:'Ana',last_name:'Souza',email:null,phone:null,company_id:null,owner_id:null,status:'lead',job_title:null,source:null,notes:null,created_at:now.toISOString(),updated_at:now.toISOString()}];data.riskRules=[{id:'rule',org_id:'org',name:'Sem próxima ação',type:'no_next_action',enabled:true,threshold_days:7,priority:1}];const before=JSON.stringify(data);const answer=copilotAnswer('O que falta nos contatos?',data,now);expect(answer.evidence[0].path).toBe('/contacts?contact=person-a');expect(answer.evidence[0].suggestion?.contact_id).toBe('person-a');expect(answer.evidence[0].fact).toContain('sem atividade');expect(JSON.stringify(data)).toBe(before);});
 it('respects disabled attention rules',()=>{const data=snapshot();data.riskRules=[{id:'rule',org_id:'org',name:'Sem responsável',type:'no_owner',enabled:false,threshold_days:7,priority:1}];expect(copilotAnswer('priorizar',data,now).evidence).toEqual([]);});
});
