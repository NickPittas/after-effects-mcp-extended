import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const elements = new Map();
const heights = new Map();
let replacements = 0;
function element() {
  const handlers = {};
  return {value:'',checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',style:{},dataset:{},children:[],scrollHeight:0,scrollTop:0,clientHeight:0,
    addEventListener(name, handler){ handlers[name]=handler; },
    dispatch(name){ handlers[name]?.({key:'Enter',preventDefault(){},stopPropagation(){}}); },
    click(){this.dispatch('click');},focus(){},setAttribute(){},
    appendChild(child){this.children.push(child);this.lastChild=child;},
    getBoundingClientRect(){
      const conversation=elements.get('conversation');
      if(this===conversation)return {top:0,bottom:this.clientHeight};
      let top=0;
      for(const child of conversation.children){if(child===this)break;top+=heights.get(child.dataset.timelineKey)||200;}
      top-=conversation.scrollTop;
      return {top,bottom:top+(heights.get(this.dataset.timelineKey)||200)};
    },
    replaceChildren(fragment){
      this.children=fragment.children;
      if(this===elements.get('conversation')){
        replacements++;
        this.scrollHeight=this.children.reduce((sum,child)=>sum+(heights.get(child.dataset.timelineKey)||200),0);
        // Model the scroll clamp/event caused by discarding the old document.
        this.scrollTop=0;this.dispatch('scroll');
      }
    },
    scrollTo({top}){this.scrollTop=Math.max(0,Math.min(top,this.scrollHeight-this.clientHeight));this.dispatch('scroll');}
  };
}
const getElement=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
getElement('conversation').clientHeight=400;
let state={provider:'pi',providerName:'Pi',hostStatus:'ready',cliStatus:'ready',bridgeStatus:'ready',busy:false,transcript:[],activityLog:[]};
const intervals=[];
const sandbox={window:{location:{search:''},cep:{fs:{makedir(){return {err:0};},readFile(file){return file.endsWith('state.json')?{err:0,data:JSON.stringify(state)}:{err:1};},writeFile(){return {err:0};}}},__adobe_cep__:{getSystemPath(){return 'C:/Test/Documents';},addEventListener(){}}},document:{getElementById:getElement,createElement:element,createDocumentFragment:element,addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},setInterval(callback,delay){intervals.push({callback,delay});},setTimeout(){},clearTimeout(){},JSON,Date,Math,Infinity,isFinite,decodeURIComponent,encodeURI,console};
vm.runInNewContext(fs.readFileSync('cep/main.js','utf8'),sandbox);
const poll=intervals.find(item=>item.delay===180).callback;
let sequence=0;
function render(){state.updatedAt=String(++sequence);poll();}
const conversation=getElement('conversation');
state.transcript=Array.from({length:20},(_,i)=>({id:'m'+i,role:'assistant',time:new Date(1700000000000+i*1000).toISOString(),text:'Message '+i}));
render();
assert.equal(conversation.scrollTop,3600,'Initial load follows latest');
conversation.scrollTop=500;conversation.dispatch('scroll');
const before=replacements;
render();render();
assert.equal(replacements,before,'Heartbeat/status-only updates must preserve the DOM');
assert.equal(conversation.scrollTop,500,'Heartbeat must preserve the reading position');
state.transcript.push({id:'m20',role:'assistant',time:new Date(1700000020000).toISOString(),text:'New message'});
render();assert.equal(conversation.scrollTop,500,'New messages must not pull the reader down');
state.busy=true;state.activity={kind:'responding'};
state.transcript.at(-1).text+=' streamed text';heights.set('message:m20',800);
render();assert.equal(conversation.scrollTop,500,'Streamed content must not pull the reader down');
state.transcript.unshift({id:'earlier',role:'system',time:new Date(1699999999000).toISOString(),text:'Earlier item'});
render();assert.equal(conversation.scrollTop,700,'Inserted content above must preserve the visible message anchor');
conversation.scrollTop=conversation.scrollHeight-conversation.clientHeight-30;conversation.dispatch('scroll');
const nearBottom=conversation.scrollTop;
state.transcript.at(-1).text+=' more';heights.set('message:m20',1000);
render();assert.equal(conversation.scrollTop,nearBottom,'A small upward scroll must also stop following');
getElement('jumpLatest').click();
assert.equal(conversation.scrollTop,conversation.scrollHeight-conversation.clientHeight,'Jump to latest must work');
state.transcript.at(-1).text+=' latest';heights.set('message:m20',1200);
render();assert.equal(conversation.scrollTop,conversation.scrollHeight-conversation.clientHeight,'Following resumes at the bottom');
assert.equal(getElement('jumpLatest').hidden,true);
console.log('Chat scroll checks passed: stable heartbeat DOM, upward reading, streaming, anchor restoration, small scrolls and explicit follow resumption.');
