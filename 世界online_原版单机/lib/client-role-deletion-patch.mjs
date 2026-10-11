export function patchImmediateRoleDeletion(source){
 const from='e.setStatusBit(_.ModelConst.STATUS_TEMP_DEL),i=T["default"].timer.serverTime+t.getShort()*f["default"].MILLIS_IN_MINUTE,e.setTimes(i),this.sendNt(d.LoginEvent.LISTPLAYER_UPDATE)';
 const to='this.data.allPlayerList=this.data.allPlayerList.filter(t=>t.getId()!=e.getId()),this.sendNt(d.LoginEvent.ON_ROLE_LIST)';
 if(source.split(from).length!==2)throw Error('v305 immediate role deletion patch mismatch');
 return source.replace(from,to);
}