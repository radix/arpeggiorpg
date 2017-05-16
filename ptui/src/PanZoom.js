// Interop between the Elm app and svg-pan-zoom.js.
// This isn't quite a general purpose wrapper for svg-pan-zoom.js, but it's an okay example.
// It receives from messages from the Elm app (for initing and updating the panzoom interface)
// and also sends some events back.


/* [Panning/Clicking State Management]
 * We have to do some tricky shenanigans to distinguish between a click-and-drag (or touch-and-swipe)
 * panning gesture from a normal click on an element. By default, a naive use of svg-pan-zoom.js
 * sends click events through to the SVG elements even if the user is panning, but that makes for
 * a very finicky UI: we only want to process a touch/click as a plain old "click" event if it didn't
 * involve the user panning around.
 * 
 * This is made especially tricky given the interoperation with Elm. So essentially we convert a few
 * (rather offhandedly chosen) events into Elm messages that we pipe into the P&T Elm app, which
 * indicates whether the user is currently panning, and the Elm app keeps track of that in a model
 * field. Then, when it is processing an event for a user clicking on an element, it checks if really
 * the user is just panning, and disregards the update if so. The very unfortunate part is that this
 * protection needs to be spread out among any event handler that happens to be activated by
 * clicking on an SVG element. A solution that only requires one check in one place would be a lot
 * nicer.
 * 
 * The events which we are reflecting in the JS/DOM/Browser side are very finicky and
 * browser-specific; the combination we're using in this code happens to work on Firefox, Chrome,
 * Android-Chrome, and iOS on my devices.
 */


function init(app, state, eventsHandler, el) {
  console.log("[initializePanZoom]", el);
  if (state.managedElements.hasOwnProperty(el)) {
    console.log("[initializePanZoom]", "Destroying existing SVG panzoom state before re-initializing");
    try {
      state.managedElements[el].destroy();
    } catch(err) {
      console.log("[initializePanZoom]", "Couldn't destroy existing SVG panzoom state.")
    }
  }
  window.requestAnimationFrame(function(_) {
    console.log("[initializePanZoom:animation]");
    state.managedElements[el] = svgPanZoom(
      el,
      { dblClickZoomEnabled: false
      , resize: true
      , center: true
      , fit: true
      , customEventsHandler: eventsHandler
      , zoomScaleSensitivity: 0.5
      // , beforePan: function() {
      //     // See [Note: Panning/Clicking State Management]
      //     app.ports.panning.send(true);
      //  }
      });
    state.managedElements[el].zoomOut();
    state.managedElements[el].zoomOut();
    state.managedElements[el].zoomOut();
  });
}

function update(state, el) {
  console.log("[updateBoundingBox]", el);
  window.requestAnimationFrame(function(_) {
    console.log("[updateBoundingBax:animate]", el);
    state.managedElements[el].updateBBox();
    state.managedElements[el].resize();
    state.managedElements[el].center();
    state.managedElements[el].fit();
    state.managedElements[el].zoomOut();
    state.managedElements[el].zoomOut();
    state.managedElements[el].zoomOut();
  });
  
}

function get_svgpanzoom_hammerjs_touch_event_handler(state) {
  // This code was largely copied from the SVG-pan-zoom mobile.html example:
  // https://github.com/ariutta/svg-pan-zoom/blob/master/demo/mobile.html
  return {
      haltEventListeners: ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel']
    , init: function(options) {
        var initialScale = 1
          , pannedX = 0
          , pannedY = 0
        // Init Hammer
        // Listen only for pointer and touch events
        this.hammer = Hammer(options.svgElement, {
          inputClass: Hammer.SUPPORT_POINTER_EVENTS ? Hammer.PointerEventInput : Hammer.TouchInput
        })
        // Enable pinch
        this.hammer.get('pinch').set({enable: true})
        // Handle pan
        this.hammer.on('panstart panmove', function(ev){
          // On pan start reset panned variables
          if (ev.type === 'panstart') {
            pannedX = 0;
            pannedY = 0;
          }
          // Pan only the difference
          options.instance.panBy({x: ev.deltaX - pannedX, y: ev.deltaY - pannedY})
          pannedX = ev.deltaX
          pannedY = ev.deltaY
        })
        // Handle pinch
        this.hammer.on('pinchstart pinchmove', function(ev){
          // On pinch start remember initial zoom
          if (ev.type === 'pinchstart') {
            initialScale = options.instance.getZoom()
            options.instance.zoom(initialScale * ev.scale)
          }
          options.instance.zoom(initialScale * ev.scale)
        })
        // Prevent moving the page on some devices when panning over SVG
        options.svgElement.addEventListener('touchmove', function(e){ e.preventDefault(); });

        // See [Note: Panning/Clicking State Management]
        options.svgElement.addEventListener('mousedown', function() {
          state.isMouseDown = true;
        });
        options.svgElement.addEventListener('mousemove', function() {
          if (state.isMouseDown) {
            app.ports.panning.send(true);
          }
        });
        options.svgElement.addEventListener('touchend', function(e) {
          app.ports.panning.send(false);
        });
        options.svgElement.addEventListener('mouseup', function() {
          state.isMouseDown = false;
        })
        options.svgElement.addEventListener('click', function() {
          app.ports.panning.send(false);
          state.isMouseDown = false;
        });
      }
    , destroy: function(){ this.hammer.destroy() }
    }
}


function PanZoom_initializePorts(app) {
  var state = {managedElements: {}, isMouseDown: false};
  var eventsHandler = get_svgpanzoom_hammerjs_touch_event_handler(state);

  app.ports.initializePanZoom.subscribe(function(s) {init(app, state, eventsHandler, s)});
  app.ports.updateBoundingBox.subscribe(function(s) {update(state, s)});
}