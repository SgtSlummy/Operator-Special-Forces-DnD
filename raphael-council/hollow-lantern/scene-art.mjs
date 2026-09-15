import {statSync} from 'node:fs';
const available=path=>{try{return typeof path==='string'&&statSync(path).isFile();}catch{return false;}};

/** Select only from the current authorized projection; never infer missing mission state. */
export function selectSceneArt(view,assets={}){
 if(view?.sceneId==='saltglass-shore'&&view.mission?.packId==='saltglass'){
  if(view.mission.courierFreed===false&&available(assets.saltglassShoreArrival))return assets.saltglassShoreArrival;
  if(view.mission.courierFreed===true&&available(assets.saltglassShoreRescued))return assets.saltglassShoreRescued;
 }
 return assets.sceneArts?.[view?.sceneId];
}
