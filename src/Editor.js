import { Viewer } from './Viewer.js';

export class Editor extends Viewer {
  constructor(params = {}) {
    super(params);

    this.editPanel = null;
    this.editPanelCells = {};

    this.initializedEditor = false;
    this.initEditor();
  }

  initEditor() {
    if (this.initializedEditor) return;

    if (this.useBuiltInControls) {
      this.rootElement.addEventListener('pointerup', this.onMouseUpEdit.bind(this), false);
    }

    this.initializedEditor = true;
  }

  onMouseUpEdit = function() {
    return function(mouse) {
      console.log('Editor.onMouseUpEdit', mouse);
    };
  };

  // onMouseUp = function() {
  //   return function(mouse) {
  //     console.log('Editor.onMouseUp', mouse);
  //   };
  // }();
}
