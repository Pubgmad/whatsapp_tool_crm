const fail=message=>{const error=new Error(message);error.code='FLOW_DESIGN_INVALID';throw error;};
const clean=value=>typeof value==='string'?value.trim():'';
function compileSingleScreen(design){
  if(!design||typeof design!=='object'||Array.isArray(design))fail('Provide a Flow design.');
  if(!/^\d+\.\d+$/.test(design.version||''))fail('Provide a supported Meta Flow JSON version.');
  if(!clean(design.title)||design.title.length>80||!clean(design.submitLabel)||design.submitLabel.length>30)fail('Enter the screen title and submit label.');
  if(!Array.isArray(design.fields)||!design.fields.length||design.fields.length>30)fail('Add between 1 and 30 fields.');
  const names=new Set(),payload={},children=[];
  for(const field of design.fields){
    if(!field||!/^[a-z][a-z0-9_]{0,49}$/.test(field.name||'')||names.has(field.name))fail('Field names must be unique lowercase identifiers.');
    names.add(field.name);
    if(!clean(field.label)||field.label.length>80||typeof field.required!=='boolean')fail('Every field needs a label and explicit required setting.');
    const common={name:field.name,label:field.label,required:field.required};
    if(['text','email','phone','number'].includes(field.type))children.push({type:'TextInput',...common,'input-type':field.type});
    else if(field.type==='textarea')children.push({type:'TextArea',...common});
    else if(field.type==='date')children.push({type:'DatePicker',...common});
    else if(['dropdown','radio','checkbox'].includes(field.type)){
      if(!Array.isArray(field.options)||!field.options.length||field.options.length>20)fail('Choice fields need between 1 and 20 options.');
      const ids=new Set();
      const options=field.options.map(option=>{if(!/^[a-zA-Z0-9_-]{1,50}$/.test(option.id||'')||ids.has(option.id)||!clean(option.title)||option.title.length>80)fail('Choice options need unique IDs and titles.');ids.add(option.id);return {id:option.id,title:option.title.trim()};});
      children.push({type:field.type==='dropdown'?'Dropdown':field.type==='radio'?'RadioButtonsGroup':'CheckboxGroup',...common,'data-source':options});
    }else fail('Unsupported field type.');
    payload[field.name]='${form.'+field.name+'}';
  }
  children.push({type:'Footer',label:design.submitLabel.trim(),'on-click-action':{name:'complete',payload}});
  return {version:design.version,screens:[{id:'FORM',title:design.title.trim(),terminal:true,success:true,data:{},layout:{type:'SingleColumnLayout',children:[{type:'Form',name:'form',children}]}}]};
}
export function compileFlowDesign(design){
  if(!Array.isArray(design?.screens))return compileSingleScreen(design);
  if(!design.screens.length||design.screens.length>10)fail('Add between 1 and 10 screens.');
  const ids=new Set(),names=new Set(),carried={};
  const screens=design.screens.map((screen,index)=>{
    if(!/^[A-Z][A-Z_]{0,49}$/.test(screen.id||'')||ids.has(screen.id))fail('Screen IDs must be unique uppercase identifiers.');
    ids.add(screen.id);
    const compiled=compileSingleScreen({...screen,version:design.version}).screens[0];
    const form=compiled.layout.children[0],footer=form.children.at(-1),payload={};
    compiled.id=screen.id;compiled.data=structuredClone(carried);
    for(const name of Object.keys(carried))payload[name]='${data.'+name+'}';
    for(const field of screen.fields){
      if(names.has(field.name)||['flow_token','__proto__','constructor','prototype'].includes(field.name))fail('Field names must be unique across all screens and cannot be reserved.');
      names.add(field.name);payload[field.name]='${form.'+field.name+'}';
      carried[field.name]=field.type==='checkbox'?{type:'array',items:{type:'string'},__example__:[]}:{type:'string',__example__:''};
    }
    const terminal=index===design.screens.length-1;
    if(terminal)footer['on-click-action']={name:'complete',payload};
    else {delete compiled.terminal;delete compiled.success;footer['on-click-action']={name:'navigate',next:{type:'screen',name:design.screens[index+1].id},payload};}
    return compiled;
  });
  return {version:design.version,screens};
}
