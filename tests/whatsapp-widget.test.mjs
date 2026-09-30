import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {widgetInput,widgetScript} from '../lib/whatsapp-widget.js';
const input={id:'widget_test',label:'Contact sales',message:'Ask about availability',origins:['https://shop.example.test'],color:'#ffffff',position:'right',enabled:true,phone:'+1 (555) 000-1111'};
test('widget configuration requires exact HTTPS origins and bounded explicit business content',()=>{
  assert.deepEqual(widgetInput(input).origins,['https://shop.example.test']);
  for(const values of [{origins:['http://shop.example.test']},{origins:['https://shop.example.test/path']},{origins:['https://user:password@shop.example.test']},{color:'red;position:fixed'},{label:''},{enabled:'true'},{message:'x'.repeat(513)}])assert.throws(()=>widgetInput({...input,...values}),{code:'WIDGET_INVALID'});
});
test('widget mounts once on authorized websites without HTML injection or credentials',()=>{
  const nodes=new Map(),elements=[];
  const document={readyState:'complete',getElementById:id=>nodes.get(id),createElement:type=>{const element={type,style:{},attachShadow:()=>({appendChild:child=>elements.push(child)})};return element;},body:{appendChild:element=>nodes.set(element.id,element)}};
  const script=widgetScript({...input,label:'</script><script>alert(1)</script>'});
  assert.equal(script.includes('</script>'),false);
  vm.runInNewContext(script,{document,window:{location:{origin:input.origins[0]}}});
  vm.runInNewContext(script,{document,window:{location:{origin:input.origins[0]}}});
  assert.equal(nodes.size,1);assert.equal(elements.length,1);assert.equal(elements[0].textContent,'</script><script>alert(1)</script>');
  const link=new URL(elements[0].href);assert.equal(link.origin,'https://wa.me');assert.equal(link.pathname,'/15550001111');assert.equal(link.searchParams.get('text'),input.message);
  assert.equal(elements[0].style.color,'#000000');assert.equal(elements[0].rel,'noopener noreferrer');
});
test('unauthorized origins and invalid phone identities cannot render a widget',()=>{
  vm.runInNewContext(widgetScript(input),{window:{location:{origin:'https://other.example.test'}},document:{getElementById:()=>{throw Error('Should not access page');}}});
  assert.throws(()=>widgetScript({...input,phone:'15550001111?redirect=evil'}),{code:'WIDGET_PHONE_INVALID'});
});
