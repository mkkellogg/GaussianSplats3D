export class ControlPanel {
    constructor(viewer, container) {
        this.viewer = viewer;
        this.container = container || document.body;

        this.visible = true;
        this.collapsed = false;

        // Dom Elements we need to reference
        this.elements = {};

        this.init();
    }

    init() {
        // Create main container
        this.panelContainer = document.createElement('div');
        this.panelContainer.className = 'control-panel';

        // Scoped Stylesheet for glassmorphism and modern inputs
        const style = document.createElement('style');
        style.innerHTML = `
            .control-panel {
                position: absolute;
                top: 10px;
                right: 10px;
                width: 280px;
                background: rgba(18, 18, 18, 0.45);
                backdrop-filter: blur(12px) saturate(180%);
                -webkit-backdrop-filter: blur(12px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.35);
                color: #f3f4f6;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                z-index: 10000;
                overflow: hidden;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                user-select: none;
                pointer-events: auto;
            }

            .control-panel.collapsed {
                width: 44px;
                height: 44px;
                border-radius: 22px;
                background: rgba(18, 18, 18, 0.85);
                border-color: rgba(255, 255, 255, 0.2);
            }

            .control-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 14px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                cursor: pointer;
                font-weight: 600;
                letter-spacing: 0.3px;
            }

            .control-panel-title {
                display: flex;
                align-items: center;
                gap: 8px;
                white-space: nowrap;
                transition: opacity 0.2s;
            }

            .control-panel.collapsed .control-panel-title {
                opacity: 0;
                width: 0;
                pointer-events: none;
            }

            .control-panel-toggle-btn {
                background: none;
                border: none;
                color: #9ca3af;
                cursor: pointer;
                padding: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: background 0.2s, color 0.2s, transform 0.3s;
                width: 24px;
                height: 24px;
            }

            .control-panel-toggle-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }

            .control-panel.collapsed .control-panel-toggle-btn {
                transform: rotate(180deg);
            }

            .control-panel-body {
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 14px;
                transition: opacity 0.2s, max-height 0.3s;
                max-height: 500px;
                overflow-y: auto;
            }

            .control-panel.collapsed .control-panel-body {
                opacity: 0;
                max-height: 0;
                padding: 0;
                pointer-events: none;
            }

            .control-panel-section {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .control-panel-section-title {
                font-size: 10px;
                text-transform: uppercase;
                color: rgba(255, 255, 255, 0.4);
                letter-spacing: 1px;
                font-weight: 700;
                margin-bottom: 2px;
            }

            .control-panel-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }

            .control-panel-label {
                color: #d1d5db;
                font-weight: 500;
            }

            /* Custom Switch Toggle */
            .control-panel-switch {
                position: relative;
                display: inline-block;
                width: 36px;
                height: 18px;
            }

            .control-panel-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .control-panel-switch-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.15);
                transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
                border-radius: 18px;
            }

            .control-panel-switch-slider:before {
                position: absolute;
                content: "";
                height: 12px;
                width: 12px;
                left: 2px;
                top: 2px;
                background-color: #e5e7eb;
                transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
                border-radius: 50%;
            }

            .control-panel-switch input:checked + .control-panel-switch-slider {
                background-color: #10b981;
                border-color: rgba(16, 185, 129, 0.3);
            }

            .control-panel-switch input:checked + .control-panel-switch-slider:before {
                transform: translateX(18px);
                background-color: #fff;
            }

            /* Custom Range Slider */
            .control-panel-range-container {
                display: flex;
                flex-direction: column;
                gap: 4px;
                width: 100%;
            }

            .control-panel-range-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .control-panel-range-value {
                font-family: monospace;
                color: #10b981;
                font-weight: 600;
                font-size: 11px;
            }

            .control-panel-range-slider {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 3px;
                border-radius: 2px;
                background: rgba(255, 255, 255, 0.15);
                outline: none;
                margin: 6px 0;
            }

            .control-panel-range-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: #fff;
                cursor: pointer;
                box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
                transition: transform 0.1s;
            }

            .control-panel-range-slider::-webkit-slider-thumb:hover {
                transform: scale(1.2);
            }

            /* Stats container */
            .control-panel-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 8px;
                padding: 8px 10px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }

            .control-panel-stat-item {
                display: flex;
                flex-direction: column;
                gap: 1px;
            }

            .control-panel-stat-label {
                font-size: 9px;
                color: rgba(255, 255, 255, 0.4);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .control-panel-stat-value {
                font-family: monospace;
                font-size: 13px;
                font-weight: 600;
                color: #10b981;
            }

            .control-panel-reset-btn {
                width: 100%;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 8px;
                color: #fff;
                padding: 8px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s, border-color 0.2s;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                margin-top: 10px;
                box-sizing: border-box;
            }

            .control-panel-reset-btn:hover {
                background: rgba(244, 63, 94, 0.2);
                border-color: rgba(244, 63, 94, 0.4);
            }
        `;
        this.panelContainer.appendChild(style);

        // Header section
        const header = document.createElement('div');
        header.className = 'control-panel-header';
        
        const title = document.createElement('div');
        title.className = 'control-panel-title';
        title.innerHTML = `
            <svg class="control-panel-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
            </svg>
            <span>Control Center</span>
        `;
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'control-panel-toggle-btn';
        toggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        `;

        header.appendChild(title);
        header.appendChild(toggleBtn);
        this.panelContainer.appendChild(header);

        // Collapse functionality on header click
        header.addEventListener('click', (e) => {
            // Prevent collapsing if clicking specifically on the button itself (already handled)
            this.toggleCollapse();
        });

        // Body section
        const body = document.createElement('div');
        body.className = 'control-panel-body';

        // 1. Visual Settings Section
        const visualSec = this.createSection('Visual Settings');

        // Splat Scale Slider
        const scaleContainer = this.createRangeSlider('Splat Scale', 0.0, 3.0, 0.05, 1.0, (val) => {
            if (!this.viewer.usingExternalCamera) {
                this.viewer.splatMesh.setSplatScale(val);
                this.viewer.forceRenderNextFrame();
            }
        });
        this.elements.scaleSlider = scaleContainer.slider;
        this.elements.scaleValue = scaleContainer.valueDisplay;
        visualSec.appendChild(scaleContainer.container);

        // Focal Length Slider
        const focalContainer = this.createRangeSlider('Focal Adjustment', 0.1, 3.0, 0.05, 1.0, (val) => {
            this.viewer.focalAdjustment = val;
            this.viewer.forceRenderNextFrame();
        });
        this.elements.focalSlider = focalContainer.slider;
        this.elements.focalValue = focalContainer.valueDisplay;
        visualSec.appendChild(focalContainer.container);

        body.appendChild(visualSec);

        // 2. View Mode Settings Section
        const modeSec = this.createSection('View Modes');

        // Point Cloud Mode Switch
        const pcRow = this.createSwitchRow('Point Cloud Mode', (checked) => {
            if (!this.viewer.usingExternalCamera) {
                this.viewer.splatMesh.setPointCloudModeEnabled(checked);
                this.viewer.forceRenderNextFrame();
            }
        });
        this.elements.pointCloudSwitch = pcRow.checkbox;
        modeSec.appendChild(pcRow.row);

        // Orthographic View Switch
        const orthoRow = this.createSwitchRow('Orthographic Camera', (checked) => {
            if (!this.viewer.usingExternalCamera) {
                this.viewer.setOrthographicMode(checked);
                this.viewer.forceRenderNextFrame();
            }
        });
        this.elements.orthoSwitch = orthoRow.checkbox;
        modeSec.appendChild(orthoRow.row);

        body.appendChild(modeSec);

        // 3. Debug Helpers Settings Section
        const debugSec = this.createSection('Debug Helpers');

        // Mesh Cursor Switch
        const cursorRow = this.createSwitchRow('Show Mesh Cursor', (checked) => {
            this.viewer.showMeshCursor = checked;
            this.viewer.forceRenderNextFrame();
        });
        this.elements.cursorSwitch = cursorRow.checkbox;
        debugSec.appendChild(cursorRow.row);

        // Control Plane Switch
        const planeRow = this.createSwitchRow('Show Control Plane', (checked) => {
            this.viewer.showControlPlane = checked;
            this.viewer.forceRenderNextFrame();
        });
        this.elements.planeSwitch = planeRow.checkbox;
        debugSec.appendChild(planeRow.row);

        body.appendChild(debugSec);

        // 4. Statistics Section
        const statsSec = this.createSection('Performance Stats');
        const statsContainer = document.createElement('div');
        statsContainer.className = 'control-panel-stats';

        const fpsItem = this.createStatItem('FPS');
        this.elements.fpsVal = fpsItem.value;
        statsContainer.appendChild(fpsItem.container);

        const sortItem = this.createStatItem('Sort Time');
        this.elements.sortVal = sortItem.value;
        statsContainer.appendChild(sortItem.container);

        statsSec.appendChild(statsContainer);
        body.appendChild(statsSec);

        // Reset Button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'control-panel-reset-btn';
        resetBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            <span>Reset Defaults</span>
        `;
        resetBtn.addEventListener('click', () => {
            if (!this.viewer.usingExternalCamera) {
                this.viewer.splatMesh.setSplatScale(1.0);
                this.viewer.setOrthographicMode(false);
                this.viewer.splatMesh.setPointCloudModeEnabled(false);
            }
            this.viewer.focalAdjustment = 1.0;
            this.viewer.showMeshCursor = false;
            this.viewer.showControlPlane = false;
            this.viewer.forceRenderNextFrame();
        });
        body.appendChild(resetBtn);

        this.panelContainer.appendChild(body);
        this.container.appendChild(this.panelContainer);
    }

    createSection(titleText) {
        const section = document.createElement('div');
        section.className = 'control-panel-section';
        const title = document.createElement('div');
        title.className = 'control-panel-section-title';
        title.innerText = titleText;
        section.appendChild(title);
        return section;
    }

    createRangeSlider(labelText, min, max, step, defaultValue, onChange) {
        const container = document.createElement('div');
        container.className = 'control-panel-range-container';

        const header = document.createElement('div');
        header.className = 'control-panel-range-header';
        
        const label = document.createElement('div');
        label.className = 'control-panel-label';
        label.innerText = labelText;

        const valueDisplay = document.createElement('div');
        valueDisplay.className = 'control-panel-range-value';
        valueDisplay.innerText = defaultValue.toFixed(2);

        header.appendChild(label);
        header.appendChild(valueDisplay);
        container.appendChild(header);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'control-panel-range-slider';
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = defaultValue;

        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valueDisplay.innerText = val.toFixed(2);
            onChange(val);
        });

        container.appendChild(slider);

        return { container, slider, valueDisplay };
    }

    createSwitchRow(labelText, onChange) {
        const row = document.createElement('div');
        row.className = 'control-panel-row';

        const label = document.createElement('div');
        label.className = 'control-panel-label';
        label.innerText = labelText;

        const switchLabel = document.createElement('label');
        switchLabel.className = 'control-panel-switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';

        const sliderKnob = document.createElement('span');
        sliderKnob.className = 'control-panel-switch-slider';

        switchLabel.appendChild(checkbox);
        switchLabel.appendChild(sliderKnob);
        row.appendChild(label);
        row.appendChild(switchLabel);

        checkbox.addEventListener('change', (e) => {
            onChange(e.target.checked);
        });

        return { row, checkbox };
    }

    createStatItem(labelText) {
        const container = document.createElement('div');
        container.className = 'control-panel-stat-item';

        const label = document.createElement('div');
        label.className = 'control-panel-stat-label';
        label.innerText = labelText;

        const value = document.createElement('div');
        value.className = 'control-panel-stat-value';
        value.innerText = 'N/A';

        container.appendChild(label);
        container.appendChild(value);

        return { container, value };
    }

    toggleCollapse() {
        this.collapsed = !this.collapsed;
        if (this.collapsed) {
            this.panelContainer.classList.add('collapsed');
        } else {
            this.panelContainer.classList.remove('collapsed');
        }
    }

    show() {
        this.panelContainer.style.display = 'block';
        this.visible = true;
    }

    hide() {
        this.panelContainer.style.display = 'none';
        this.visible = false;
    }

    setContainer(container) {
        if (this.container && this.panelContainer.parentElement === this.container) {
            this.container.removeChild(this.panelContainer);
        }
        if (container) {
            this.container = container;
            this.container.appendChild(this.panelContainer);
        }
    }

    update(fps, sortTime, splatScale, focalAdjustment, pointCloudMode, orthographic, showMeshCursor, showControlPlane) {
        if (!this.visible || this.collapsed) return;

        // Sync FPS and Sort Time text readouts
        if (this.elements.fpsVal.innerText !== String(fps)) {
            this.elements.fpsVal.innerText = fps;
        }
        const sortTimeStr = typeof sortTime === 'number' ? `${sortTime.toFixed(2)} ms` : sortTime;
        if (this.elements.sortVal.innerText !== sortTimeStr) {
            this.elements.sortVal.innerText = sortTimeStr;
        }

        // Bidirectional sync for Sliders
        if (this.elements.scaleSlider && Math.abs(parseFloat(this.elements.scaleSlider.value) - splatScale) > 0.01) {
            this.elements.scaleSlider.value = splatScale;
            this.elements.scaleValue.innerText = splatScale.toFixed(2);
        }
        if (this.elements.focalSlider && Math.abs(parseFloat(this.elements.focalSlider.value) - focalAdjustment) > 0.01) {
            this.elements.focalSlider.value = focalAdjustment;
            this.elements.focalValue.innerText = focalAdjustment.toFixed(2);
        }

        // Bidirectional sync for Switches
        if (this.elements.pointCloudSwitch && this.elements.pointCloudSwitch.checked !== pointCloudMode) {
            this.elements.pointCloudSwitch.checked = pointCloudMode;
        }
        if (this.elements.orthoSwitch && this.elements.orthoSwitch.checked !== orthographic) {
            this.elements.orthoSwitch.checked = orthographic;
        }
        if (this.elements.cursorSwitch && this.elements.cursorSwitch.checked !== showMeshCursor) {
            this.elements.cursorSwitch.checked = showMeshCursor;
        }
        if (this.elements.planeSwitch && this.elements.planeSwitch.checked !== showControlPlane) {
            this.elements.planeSwitch.checked = showControlPlane;
        }
    }
}
