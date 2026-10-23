<script lang="ts">
  import type { MeasurementSession } from '../sessions/types';
  export let session:MeasurementSession;
  const width=840,height=190,left=48,right=16,top=16,bottom=28;
  function paths(value:MeasurementSession){
    let limit=5;for(const p of value.samples)if(p.valid)limit=Math.max(limit,Math.abs(p.sample.centered.x),Math.abs(p.sample.centered.y));
    const duration=Math.max(1,value.metrics.durationSeconds*1000),stride=Math.max(1,Math.ceil(value.samples.length/2000));
    let x='',y='',pen=false;
    for(let i=0;i<value.samples.length;i++){
      const point=value.samples[i];if(!point.valid||point.breakBefore)pen=false;
      if(!point.valid||(i%stride&&i!==value.samples.length-1))continue;
      const px=left+point.timeMs/duration*(width-left-right),cy=(height-bottom+top)/2,scale=(height-bottom-top)/2/limit;
      const command=pen?'L':'M';x+=`${command}${px.toFixed(1)},${(cy-point.sample.centered.x*scale).toFixed(1)} `;y+=`${command}${px.toFixed(1)},${(cy-point.sample.centered.y*scale).toFixed(1)} `;pen=true;
    }
    return {x,y,limit,duration:value.metrics.durationSeconds};
  }
  $: trace=paths(session);
</script>
<section class="card"><div class="chart-heading"><h3>Координаты во времени</h3><div><span class="x-key">● X</span><span class="y-key">● Y</span></div></div>
  <svg viewBox="0 0 840 190" role="img" aria-label="Координаты центра давления X и Y во времени, разрывы сигнала не соединены">
    <line x1={left} x2={width-right} y1={(height-bottom+top)/2} y2={(height-bottom+top)/2} stroke="#dce5df"/>
    <line x1={left} x2={left} y1={top} y2={height-bottom} stroke="#dce5df"/>
    <path d={trace.x} fill="none" stroke="#168b76" stroke-width="1.5"/>
    <path d={trace.y} fill="none" stroke="#9a80bb" stroke-width="1.5"/>
    <text x="4" y={top+8}>{trace.limit.toFixed(1)}</text><text x="12" y={(height-bottom+top)/2+4}>0</text><text x="0" y={height-bottom}>−{trace.limit.toFixed(1)}</text>
    <text x={left} y={height-5}>0 с</text><text x={width-right} y={height-5} text-anchor="end">{trace.duration.toFixed(1)} с</text>
  </svg><p class="small muted">Миллиметры · время измерения. Невалидные участки и разрывы исключены.</p>
</section>
<style>.chart-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.chart-heading div{display:flex;gap:16px;font-size:12px}.x-key{color:#168b76}.y-key{color:#9a80bb}svg{display:block;width:100%;height:auto}text{font:11px sans-serif;fill:#829385}</style>
