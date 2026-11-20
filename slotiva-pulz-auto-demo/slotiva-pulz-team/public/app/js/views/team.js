import {get,post,patch} from '../api.js';
import {h,toast} from '../ui.js';
export async function mount({view,setSubtitle}) {
  setSubtitle('PULZ Barbershop · účty a přepínání kalendářů');
  const state=await get('/team');
  const selected=Number(sessionStorage.getItem('pulz-barber'))||state.ownerId;
  const title=h('h3',{},'Přepnout kalendář');
  const picker=h('select',{class:'input',onChange:e=>{sessionStorage.setItem('pulz-barber',e.target.value);location.hash='#/kalendar';location.reload();}},
    h('option',{value:String(state.ownerId),selected:selected===state.ownerId},'Hlavní kalendář'),
    ...state.members.filter(m=>m.active).map(m=>h('option',{value:String(m.id),selected:selected===m.id},m.name)));
  if(state.isOwner)view.append(h('div',{class:'card',style:{padding:'20px',marginBottom:'16px'}},title,picker));
  const members=h('div',{class:'card',style:{padding:'20px'}});view.append(members);
  async function reload(){const {members:list}=await get('/team');members.replaceChildren(h('h3',{},'Správa týmu'),...list.map(m=>h('div',{style:{padding:'12px',borderBottom:'1px solid #9993'}},
    h('strong',{},m.name),h('p',{},m.email),h('span',{},m.active?'Aktivní':'Neaktivní'),
    state.isOwner?h('button',{class:'btn btn-sm btn-secondary',style:{marginLeft:'12px'},onClick:async()=>{try{await patch(`/team/${m.id}`,{active:!m.active});await reload();}catch(e){toast(e.message,{error:true});}}},m.active?'Deaktivovat':'Aktivovat'):null)));}
  await reload();
  if(!state.isOwner)return;
  const activate=h('form',{class:'card',style:{padding:'20px',marginTop:'16px'},onSubmit:async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await post(`/team/${data.memberId}/activate`,{email:data.email,password:data.password});e.currentTarget.reset();toast('Přihlašovací údaje nastaveny');await reload();}catch(err){toast(err.message,{error:true});}}},
    h('h3',{},'Aktivovat účet barbera'),
    h('label',{},'Barber',h('select',{name:'memberId',required:true,class:'input'},...state.members.map(m=>h('option',{value:String(m.id)},m.name)))),
    ...[['email','Přihlašovací e-mail'],['password','Nové heslo (min. 8 znaků)']].map(([name,label])=>h('label',{style:{display:'block',margin:'12px 0'}},label,h('input',{name,required:true,type:name==='password'?'password':'email',minLength:name==='password'?8:undefined,class:'input',style:{display:'block',width:'100%'}}))),
    h('button',{class:'btn btn-primary',type:'submit'},'Nastavit přístup'));
  if(state.members.length)view.append(activate);
  view.append(h('p',{style:{marginTop:'12px'}},'Demo rezervace pro Kikina a Honzu se vytvořily automaticky při první registraci majitele. Pro skutečné přihlášení barberů nastav jejich e-mail a heslo níže.'));
  const form=h('form',{class:'card',style:{padding:'20px',marginTop:'16px'},onSubmit:async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await post('/team',data);e.currentTarget.reset();toast('Účet vytvořen');await reload();}catch(err){toast(err.message,{error:true});}}},
    h('h3',{},'Přidat barbera'),h('p',{},'Každý barber má vlastní e-mail a heslo. Údaje neposílejte přes chat.'),
    ...[['name','Jméno'],['email','Přihlašovací e-mail'],['password','Heslo (min. 8 znaků)']].map(([name,label])=>h('label',{style:{display:'block',margin:'12px 0'}},label,h('input',{name,required:true,type:name==='password'?'password':name==='email'?'email':'text',minLength:name==='password'?8:undefined,class:'input',style:{display:'block',width:'100%'}}))),
    h('button',{class:'btn btn-primary',type:'submit'},'Vytvořit účet'));view.append(form);
}
