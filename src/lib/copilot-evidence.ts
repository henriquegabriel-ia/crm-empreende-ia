import type { CrmSnapshot } from '@/hooks/useCrmSnapshot';
import { attentionQueue,activitySummary } from '@/lib/activity-logic';
import { contactName,normalizeSearch } from '@/lib/contact-model';
export interface CopilotEvidence { id:string; title:string; path:string; fact:string; suggestion?:{title:string;body:string;deal_id?:string;contact_id?:string} }
export interface CopilotAnswer { summary:string; evidence:CopilotEvidence[]; unknown:string[] }
/** Explainable record analysis; no external model, hidden score or invented client facts. */
export function copilotAnswer(question:string,data:CrmSnapshot,now=new Date()):CopilotAnswer {
 const q=normalizeSearch(question);const queue=attentionQueue(data,now);
 const wantsContacts=/contato|relacionamento|pessoa/.test(q),wantsDeals=/oportunidade|negocio|parad|pipeline|funil/.test(q);
 const chosen=queue.filter(item=>wantsContacts?item.key.startsWith('contact:'):wantsDeals?item.key.startsWith('deal:'):true).slice(0,6);
 let evidence:CopilotEvidence[]=chosen.map(item=>{
  const [kind,id]=item.key.split(':');
  return {id:item.key,title:item.title,path:item.path,fact:item.reasons.map(reason=>reason.explanation).join(' '),
   suggestion:kind==='deal'||kind==='contact'?{title:'Definir próximo passo: '+item.title,body:'Sugestão para revisão da equipe. Motivo observado: '+item.reasons.map(reason=>reason.explanation).join(' '),...(kind==='deal'?{deal_id:id}:{contact_id:id})}:undefined};
 });
 const conventional=/prioriz|hoje|aten[cç][aã]o|pend[eê]n|contato|relacionamento|pessoa|oportunidade|negocio|parad|pipeline|funil|resumo/.test(q);
 if(!conventional){
  evidence=[...data.contacts.filter(c=>normalizeSearch(contactName(c)).includes(q)).map(c=>({id:'contact:'+c.id,title:contactName(c),path:'/contacts?contact='+c.id,fact:`Situação registrada: ${c.status}. ${c.owner_id?'Há um responsável definido.':'Não há responsável definido.'}`})),...data.deals.filter(d=>normalizeSearch(d.title).includes(q)).map(d=>({id:'deal:'+d.id,title:d.title,path:'/pipeline?deal='+d.id,fact:`Situação registrada: ${d.status==='open'?'em aberto':d.status==='won'?'ganha':'perdida'}. Valor: ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:d.currency}).format(d.value)}.`}))].slice(0,6);
 }
 const summary=activitySummary(data.activities,now);
 return {summary:!conventional?(evidence.length?'Encontrei estes registros correspondentes à busca.':'Não encontrei registros suficientes para responder. Posso analisar prioridades, oportunidades e contatos pelo nome.'):chosen.length?`Encontrei ${chosen.length} itens para revisar${queue.length>6?' nesta seleção':''}. A ordem usa as regras de atenção configuradas pela organização.`:`Nenhum item corresponde às regras ativas deste recorte. Há ${summary.pending.length} atividades pendentes na organização; isso não significa que todos os relacionamentos estejam resolvidos.`,evidence,unknown:['Não conheço conversas, acordos ou pagamentos que não estejam registrados no CRM.','As sugestões são inferências operacionais para sua revisão; não são compromissos já combinados com o cliente.']};
}
