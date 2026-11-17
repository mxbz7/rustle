/* Runs before the page is drawn so the saved theme never flashes. */
(function(){
try{
var t=localStorage.getItem("rustle-theme");
if(t!=="light"&&t!=="dark")t="dark";
document.documentElement.setAttribute("data-theme",t);
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute("content",t==="light"?"#f6f5fb":"#0d0c13");
}catch(e){}
})();
