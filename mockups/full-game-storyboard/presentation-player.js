(function(){
  const slides=[...document.querySelectorAll('.presentation-slide')];
  const menu=document.querySelector('#slide-select');
  const index=document.querySelector('.presentation-index');
  let current=Math.max(0,Math.min(slides.length-1,(Number(location.hash.slice(1))||1)-1));
  const images=JSON.parse(document.querySelector('#presentation-images').textContent);
  const sources=JSON.parse(document.querySelector('#presentation-sources').textContent);
  for(const img of document.querySelectorAll('img[data-asset]')) img.src=images[img.dataset.asset];
  function fit(){const viewport=slides[current].querySelector('.screen-viewport'),canvas=viewport.querySelector('.screen-canvas');const scale=Math.min(viewport.clientWidth/1280,viewport.clientHeight/760);canvas.style.transform=`translate(-50%,-50%) scale(${scale})`;}
  function show(number){
    current=Math.max(0,Math.min(slides.length-1,number));
    slides.forEach((slide,i)=>{slide.classList.toggle('current',i===current);slide.setAttribute('aria-hidden',String(i!==current));});
    menu.value=String(current);document.querySelector('#previous').disabled=current===0;document.querySelector('#next').disabled=current===slides.length-1;
    document.querySelector('.presentation-count').textContent=`${String(current+1).padStart(2,'0')} / ${slides.length}`;
    document.querySelector('.progress-track>div').style.width=`${(current+1)/slides.length*100}%`;
    document.querySelector('#interactive-link').href=`index.html?view=walk&panel=${current+1}`;
    document.title=`Raphael · ${String(current+1).padStart(2,'0')}/30 · ${slides[current].dataset.title}`;
    history.replaceState(null,'',`#${current+1}`);fit();
  }
  document.querySelector('#previous').addEventListener('click',()=>show(current-1));
  document.querySelector('#next').addEventListener('click',()=>show(current+1));
  menu.addEventListener('change',()=>show(Number(menu.value)));
  document.querySelector('#index-button').addEventListener('click',()=>{index.hidden=false;document.querySelector('#close-index').focus();});
  document.querySelector('#close-index').addEventListener('click',()=>{index.hidden=true;document.querySelector('#index-button').focus();});
  for(const button of document.querySelectorAll('[data-slide]'))button.addEventListener('click',()=>{index.hidden=true;show(Number(button.dataset.slide));});
  document.querySelector('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{document.body.classList.toggle('presentation-zoom');fit();}});
  document.querySelector('#zoom').addEventListener('click',()=>{document.body.classList.toggle('presentation-zoom');fit();});
  document.querySelector('.zoom-exit').addEventListener('click',()=>{document.body.classList.remove('presentation-zoom');fit();});
  document.querySelector('#download').addEventListener('click',()=>{
    const clone=document.documentElement.cloneNode(true);for(const image of clone.querySelectorAll('img[data-asset]'))image.removeAttribute('src');
    clone.querySelector('body').classList.remove('presentation-zoom');
    const url=URL.createObjectURL(new Blob(['<!doctype html>'+clone.outerHTML],{type:'text/html'}));
    const link=document.createElement('a');link.href=url;link.download='Raphael-Behind-the-Veil-30-frame-presentation.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  for(const button of document.querySelectorAll('[data-source]'))button.addEventListener('click',()=>{
    const source=sources.find(e=>e.id===button.dataset.source);if(!source)return;
    const modal=document.querySelector('.presentation-source');modal.querySelector('h2').textContent=`${source.id} · ${source.tag}`;modal.querySelector('small').textContent=`${source.speaker} · ${source.time}`;modal.querySelector('p').textContent=source.text;modal.hidden=false;modal.querySelector('button').focus();
  });
  document.querySelector('#close-source').addEventListener('click',()=>{document.querySelector('.presentation-source').hidden=true;});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){index.hidden=true;document.querySelector('.presentation-source').hidden=true;document.body.classList.remove('presentation-zoom');fit();return;}
    if(e.target.closest('input,textarea,select')||!index.hidden||!document.querySelector('.presentation-source').hidden)return;
    if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(current+1);}
    if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(current-1);}
    if(e.key==='Home'){e.preventDefault();show(0);}if(e.key==='End'){e.preventDefault();show(slides.length-1);}
  });
  window.addEventListener('resize',fit);window.addEventListener('hashchange',()=>show((Number(location.hash.slice(1))||1)-1));
  show(current);
})();
