export class InfoPanel {

    constructor(container) {

        this.container = container || document.body;

        this.infoCells = {};

        const layout = [
            ['Camera position', 'cameraPosition'],
            ['Camera look-at', 'cameraLookAt'],
            ['Camera up', 'cameraUp'],
            ['Camera mode', 'orthographicCamera'],
            ['Cursor position', 'cursorPosition'],
            ['FPS', 'fps'],
            ['Rendering:', 'renderSplatCount'],
            ['Sort time', 'sortTime'],
            ['Render window', 'renderWindow'],
            ['Focal adjustment', 'focalAdjustment'],
            ['Splat scale', 'splatScale'],
            ['Point cloud mode', 'pointCloudMode']
        ];

        this.infoPanelContainer = document.createElement('div');
        const style = document.createElement('style');
        style.innerHTML = `

            .infoPanel {
                width: 430px;
                padding: 10px;
                background-color: rgba(50, 50, 50, 0.85);
                border: #555555 2px solid;
                color: #dddddd;
                border-radius: 10px;
                z-index: 9999;
                font-family: arial;
                font-size: 11pt;
                text-align: left;
                margin: 0;
                top: 10px;
                left:10px;
                position: absolute;
                pointer-events: auto;
            }

            .info-panel-cell {
                margin-bottom: 5px;
                padding-bottom: 2px;
            }

            .label-cell {
                font-weight: bold;
                font-size: 12pt;
                width: 140px;
            }

        `;
        this.infoPanelContainer.append(style);

        this.infoPanel = document.createElement('div');
        this.infoPanel.className = 'infoPanel';

        const infoTable = document.createElement('div');
        infoTable.style.display = 'table';

        for (let layoutEntry of layout) {
            const row = document.createElement('div');
            row.style.display = 'table-row';
            row.className = 'info-panel-row';

            const labelCell = document.createElement('div');
            labelCell.style.display = 'table-cell';
            labelCell.innerHTML = `${layoutEntry[0]}: `;
            labelCell.classList.add('info-panel-cell', 'label-cell');

            const spacerCell = document.createElement('div');
            spacerCell.style.display = 'table-cell';
            spacerCell.style.width = '10px';
            spacerCell.innerHTML = ' ';
            spacerCell.className = 'info-panel-cell';

            const infoCell = document.createElement('div');
            infoCell.style.display = 'table-cell';
            infoCell.innerHTML = '';
            infoCell.className = 'info-panel-cell';

            this.infoCells[layoutEntry[1]] = infoCell;

            row.appendChild(labelCell);
            row.appendChild(spacerCell);
            row.appendChild(infoCell);

            infoTable.appendChild(row);
        }

        this.infoPanel.appendChild(infoTable);
        this.infoPanelContainer.append(this.infoPanel);
        this.infoPanelContainer.style.display = 'none';
        this.container.appendChild(this.infoPanelContainer);

        this.visible = false;
    }

    update = function(renderDimensions, cameraPosition, cameraLookAtPosition, cameraUp, orthographicCamera,
                      meshCursorPosition, currentFPS, splatCount, splatRenderCount,
                      splatRenderCountPct, lastSortTime, focalAdjustment, splatScale, pointCloudMode) {

        const cameraPosString = `${cameraPosition.x.toFixed(5)}, ${cameraPosition.y.toFixed(5)}, ${cameraPosition.z.toFixed(5)}`;
        if (this.infoCells.cameraPosition.innerHTML !== cameraPosString) {
            this.infoCells.cameraPosition.innerHTML = cameraPosString;
        }

        if (cameraLookAtPosition) {
            const cla = cameraLookAtPosition;
            const cameraLookAtString = `${cla.x.toFixed(5)}, ${cla.y.toFixed(5)}, ${cla.z.toFixed(5)}`;
            if (this.infoCells.cameraLookAt.innerHTML !== cameraLookAtString) {
                this.infoCells.cameraLookAt.innerHTML = cameraLookAtString;
            }
        }

        const cameraUpString = `${cameraUp.x.toFixed(5)}, ${cameraUp.y.toFixed(5)}, ${cameraUp.z.toFixed(5)}`;
        if (this.infoCells.cameraUp.innerHTML !== cameraUpString) {
            this.infoCells.cameraUp.innerHTML = cameraUpString;
        }

        this.infoCells.orthographicCamera.innerHTML = orthographicCamera ? 'Orthographic' : 'Perspective';

        if (meshCursorPosition) {
            const cursPos = meshCursorPosition;
            const cursorPosString = `${cursPos.x.toFixed(5)}, ${cursPos.y.toFixed(5)}, ${cursPos.z.toFixed(5)}`;
            this.infoCells.cursorPosition.innerHTML = cursorPosString;
        } else {
            this.infoCells.cursorPosition.innerHTML = 'N/A';
        }

        this.infoCells.fps.innerHTML = currentFPS;
        this.infoCells.renderWindow.innerHTML = `${renderDimensions.x} x ${renderDimensions.y}`;

        this.infoCells.renderSplatCount.innerHTML =
            `${splatRenderCount} splats out of ${splatCount} (${splatRenderCountPct.toFixed(2)}%)`;

        this.infoCells.sortTime.innerHTML = `${lastSortTime.toFixed(3)} ms`;
        this.infoCells.focalAdjustment.innerHTML = `${focalAdjustment.toFixed(3)}`;
        this.infoCells.splatScale.innerHTML = `${splatScale.toFixed(3)}`;
        this.infoCells.pointCloudMode.innerHTML = `${pointCloudMode}`;
    };

    setContainer(container) {
        if (this.container && this.infoPanelContainer.parentElement === this.container) {
            this.container.removeChild(this.infoPanelContainer);
        }
        if (container) {
            this.container = container;
            this.container.appendChild(this.infoPanelContainer);
            this.infoPanelContainer.style.zIndex = this.container.style.zIndex + 1;
        }
    }

    show() {
        this.infoPanelContainer.style.display = 'block';
        this.visible = true;
    }

    hide() {
        this.infoPanelContainer.style.display = 'none';
        this.visible = false;
    }

}
