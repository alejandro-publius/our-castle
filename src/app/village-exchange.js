import { api } from './api.js';
const $ = id => document.getElementById(id);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2),v);
    else el.setAttribute(k,v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const field = (label, input) => { input.setAttribute('aria-label',label); return h('label',{class:'field'},h('span',{},label),input); };
const input = (name,type='text',attrs={}) => h('input',{name,type,...attrs});
const button = (label, action, attrs={}) => h('button',{type:'button',onclick:action,...attrs},label);
const values = form => Object.fromEntries(new FormData(form));
const stateText = { offered:'Offered · not in your kit yet', accepted:'Accepted · waiting for handover', received:'Received · available for the agreed dates', returned:'Returned or released', withdrawn:'Withdrawn', declined:'Declined' };

export function createVillageExchange({getState,actor,applyState,onCompare}) {
  const root=$('village-exchange'), forms=$('exchange-forms'), board=$('exchange-board'), status=$('exchange-status');
  let built=null, busy=false, preview=null, lastBoard=null;
  const scope=()=>JSON.stringify([getState()?.household?.id,getState()?.goal?.id,actor()?.id]);
  const adult=()=>actor()?.role==='adult';
  const say=text=>{status.textContent=text;};
  async function act(action, data={}) {
    if(busy || !adult()) return null;
    const before=scope();busy=true;say('Saving…');root.setAttribute('aria-busy','true');
    try {
      const res=await api.post('/api/exchange',{action,...data,...(getState().access?{}:{memberId:actor().id})});
      if(before!==scope()) return null;
      applyState(res.state);say(action==='receive'?'Item received. Compare the kit to see what is left to buy.':action==='return'?'Kit updated. Compare again before changing the plan.':'Saved.');
      return res;
    }catch(e){if(before===scope()) { say(e.message); if(e.code==='exchange_kit_changed') status.append(button('Review the latest kit',()=>{buildForms();say('Choose an item from the latest saved kit, then review before sharing.');})); }return null;}
    finally{busy=false;root.removeAttribute('aria-busy');}
  }
  function form(contents, label, submit) {
    const f=h('form',{class:'exchange-form'},contents,h('button',{type:'submit'},label));
    f.addEventListener('input',()=>{f.dataset.dirty='true';});
    f.addEventListener('submit',e=>{e.preventDefault();if(f.reportValidity())submit(values(f),f);});return f;
  }
  function buildForms() {
    forms.replaceChildren();preview=null;
    if(!adult()){forms.append(h('p',{class:'fine'},'Adults manage sharing. Everyone in the family can read the board.'));return;}
    const ex=getState().exchange;
    if(!ex.neighborhood){
      forms.append(h('details',{},h('summary',{},'Start a neighborhood'),form([
        field('Neighborhood name',input('name','text',{required:true,maxlength:50})),
        field('Your shared family name',input('alias','text',{required:true,maxlength:40})),
      ],'Create neighborhood',v=>act('create',v))));
      const join=form([
        field('Invitation code',input('token','text',{required:true,autocomplete:'off',spellcheck:'false',maxlength:48})),
        field('Your shared family name',input('alias','text',{required:true,maxlength:40})),
      ],'Review invitation',async(v,f)=>{
        const res=await act('preview',{token:v.token.trim()});if(!res)return;
        preview={...v,token:v.token.trim()};
        const confirmation=h('div',{class:'exchange-confirm'},h('p',{},`Join ${res.preview.name}? Neighbors see your chosen family name and the needs you choose to share. Your household records stay private.`),
          button('Join this neighborhood',()=>act('join',{...preview,confirmed:true})),button('Cancel',()=>{confirmation.remove();preview=null;}));
        f.querySelector('.exchange-confirm')?.remove();f.append(confirmation);
      });
      forms.append(h('details',{},h('summary',{},'Join with an invitation'),join));return;
    }
    const needed=getState().kit.items.filter(i=>i.remaining>0&&!ex.requests.some(r=>r.mine&&r.status==='open'&&r.item===i.name));
    if(needed.length) {
      const select=h('select',{name:'lineId',required:true},needed.map(i=>h('option',{value:i.id},`${i.name} · ${i.remaining} to get`)));
      const f=form([
        field('Item from your saved kit',select),
        field('How many',input('quantity','number',{required:true,min:1,max:100,value:1})),
        field('Needed through',input('neededUntil','date',{required:true,value:getState().goal.targetDate})),
        field('A note for neighbors',input('note','text',{maxlength:160,placeholder:'Optional · no addresses or private bills'})),
        h('label',{class:'check'},input('confirmed','checkbox',{required:true}),' Share this item’s name, requirements, quantity, date and note with the neighborhood.'),
      ],'Share this need',(v,f)=>act('request',{...v,quantity:Number(v.quantity),confirmed:v.confirmed==='on',kitRevision:Number(f.dataset.revision)}));
      f.dataset.revision=getState().kit.revision;f.dataset.kitRequest='true';
      forms.append(h('details',{},h('summary',{},'Ask neighbors for an item'),f));
    }else forms.append(h('p',{class:'fine'},'Add the items you still need to the kit list to ask your neighbors.'));
    if(ex.neighborhood.owner){
      const output=h('div',{class:'exchange-invite-output'});
      forms.append(h('details',{},h('summary',{},'Invite another family'),h('p',{class:'fine'},'One family can use each code, within 24 hours. Share it with someone you know.'),
        button('Create invitation',async()=>{const res=await act('invite');if(!res)return;
          output.replaceChildren(field('Invitation code to share',h('textarea',{rows:2,readonly:true},res.invitation.token)),h('p',{class:'fine'},'This code is shown here once. Anyone with it can join until it is used, revoked or expires.'));
        }),output));
    }
    forms.append(h('details',{},h('summary',{},'Neighborhood settings'),button('Leave neighborhood',()=>act('leave'))));
  }
  function requestRow(r) {
    const row=h('li',{class:'exchange-request','data-request':r.id},h('div',{class:'exchange-request-heading'},h('h4',{tabindex:'-1'},r.item),h('span',{class:'fine'},r.mine?'Your family':r.family)),
      h('p',{class:'fine'},`${r.quantity} needed · through ${r.neededUntil}${r.needs?` · ${r.needs}`:''}`),r.note&&h('p',{},r.note));
    if(r.status==='closed')row.append(h('p',{class:'fine'},'Closed'));
    for(const o of r.offers){
      const block=h('div',{class:'exchange-offer','data-offer':o.id},h('strong',{},`${o.quantity} · ${o.kind==='loan'?'Loan':'Gift'} ${o.mine?'from your family':`from ${o.family}`}`),
        h('p',{class:'fine'},`${stateText[o.status]}${o.returnBy?` · return by ${o.returnBy}`:''}`),o.note&&h('p',{},o.note));
      const actions=h('div',{class:'actions'}), ids={requestId:r.id,offerId:o.id};
      if(adult()){
        if(r.mine&&o.status==='offered')actions.append(button('Accept offer',()=>act('accept',ids)));
        if(r.mine&&o.status==='accepted')actions.append(button('I received the item',()=>act('receive',ids)));
        if(r.mine&&o.status==='received')actions.append(button(o.kind==='loan'?'I returned the item':'Stop counting this gift',()=>act('return',ids)));
        if(['offered','accepted'].includes(o.status))actions.append(button(o.mine?'Withdraw offer':'Decline offer',()=>act('cancel',ids),{class:'link-button'}));
      }
      block.append(actions);row.append(block);
    }
    if(adult()&&r.status==='open'){
      if(r.mine){
        if(!r.offers.some(o=>['accepted','received'].includes(o.status)))row.append(button('Close request',()=>act('close',{requestId:r.id}),{class:'link-button'}));
      }else if(r.openQuantity>0&&!r.offers.some(o=>['offered','accepted','received'].includes(o.status))){
        const f=form([
          field('How many to offer',input('quantity','number',{required:true,min:1,max:r.openQuantity,value:1})),
          field('Offer as',h('select',{name:'kind'},h('option',{value:'loan'},'Loan'),h('option',{value:'gift'},'Gift'))),
          field('Return by (loans)',input('returnBy','date',{value:r.neededUntil})),
          field('Item details for this family',input('note','text',{maxlength:160,placeholder:'Condition, size or what is included'})),
        ],'Offer item',v=>act('offer',{...v,requestId:r.id,quantity:Number(v.quantity)}));
        row.append(h('details',{},h('summary',{},'Offer an item'),f));
      }else if(!r.offers.length)row.append(h('p',{class:'fine'},'This need is covered by an accepted offer.'));
    }
    return row;
  }
  function render() {
    const s=getState(),ex=s?.exchange;root.hidden=!ex?.available;if(root.hidden)return;
    $('exchange-summary').textContent=ex.neighborhood?`${ex.neighborhood.name} · ${ex.neighborhood.households} ${ex.neighborhood.households===1?'family':'families'}`:'Borrow, lend or give an item';
    const key=JSON.stringify([scope(),adult(),ex.neighborhood && [ex.neighborhood.name,ex.neighborhood.alias,ex.neighborhood.owner]]);
    if(key!==built){built=key;buildForms();lastBoard=null;say('');}
    // Draft forms survive live updates. The server refuses their stale kit revision explicitly.
    const requestForm=forms.querySelector('[data-kit-request]');
    if(requestForm && requestForm.dataset.dirty!=='true' && Number(requestForm.dataset.revision)!==s.kit.revision){
      const select=requestForm.querySelector('[name=lineId]');
      const needed=s.kit.items.filter(i=>i.remaining>0&&!ex.requests.some(r=>r.mine&&r.status==='open'&&r.item===i.name));
      select.replaceChildren(...needed.map(i=>h('option',{value:i.id},`${i.name} · ${i.remaining} to get`)));
      requestForm.closest('details').hidden=!needed.length;requestForm.dataset.revision=s.kit.revision;
    }
    const data=JSON.stringify(ex);
    if(lastBoard!==data){
      const drafts=new Map([...board.querySelectorAll('input,select')].map(el=>[`${el.closest('[data-request]')?.dataset.request}:${el.name}`,el.value]));
      const opened=new Set([...board.querySelectorAll('details[open]')].map(el=>el.closest('[data-request]')?.dataset.request));
      const focused=document.activeElement, focusRequest=focused?.closest('[data-request]')?.dataset.request, focusName=focused?.name, focusAction=focused?.matches('button')?focused.textContent:null, focusOffer=focused?.closest('[data-offer]')?.dataset.offer;
      board.replaceChildren(...ex.requests.map(requestRow));
      for(const el of board.querySelectorAll('input,select')){const id=`${el.closest('[data-request]').dataset.request}:${el.name}`;if(drafts.has(id))el.value=drafts.get(id);}
      for(const el of board.querySelectorAll('details'))if(opened.has(el.closest('[data-request]')?.dataset.request))el.open=true;
      if(focusRequest&&focusName)board.querySelector(`[data-request="${focusRequest}"] [name="${focusName}"]`)?.focus({preventScroll:true});
      if(focusRequest&&focusAction){ const row=board.querySelector(`[data-request="${focusRequest}"]`), within=focusOffer?row?.querySelector(`[data-offer="${focusOffer}"]`):row; const next=[...(within?.querySelectorAll('button')??[])].find(b=>b.textContent===focusAction); (next??row?.querySelector('h4'))?.focus({preventScroll:true}); }
      lastBoard=data;
    }
    $('exchange-empty').hidden=ex.requests.length>0||!ex.neighborhood;
    const invites=$('exchange-invites');invites.replaceChildren();
    if(adult()) for(const i of ex.invites.filter(i=>!i.usedAt&&!i.revokedAt))invites.append(h('li',{},h('span',{class:'fine'},`Invitation · expires ${new Date(i.expiresAt).toLocaleDateString()}`),button('Revoke',()=>act('revoke-invite',{inviteId:i.id}),{class:'link-button'})));
    $('exchange-compare').hidden=!s.kit?.items?.length;
  }
  $('exchange-compare').addEventListener('click',onCompare);
  return {render,open(){root.open=true;root.scrollIntoView({block:'start',behavior:'auto'});root.querySelector('summary').focus();}};
}
