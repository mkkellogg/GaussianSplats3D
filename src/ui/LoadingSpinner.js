import { fadeElement } from './Util.js';

const STANDARD_FADE_DURATION = 500;

export class LoadingSpinner {

    static elementIDGen = 0;

    constructor(message, container) {

        this.taskIDGen = 0;
        this.elementID = LoadingSpinner.elementIDGen++;

        this.tasks = [];

        this.message = message || 'Loading...';
        this.container = container || document.body;

        this.spinnerContainerOuter = document.createElement('div');
        this.spinnerContainerOuter.className = `spinnerOuterContainer${this.elementID}`;
        this.spinnerContainerOuter.style.display = 'none';

        this.spinnerContainerPrimary = document.createElement('div');
        this.spinnerContainerPrimary.className = `spinnerContainerPrimary${this.elementID}`;
        this.spinnerPrimary = document.createElement('div');
        this.spinnerPrimary.classList.add(`spinner${this.elementID}`, `spinnerPrimary${this.elementID}`);
        this.messageContainerPrimary = document.createElement('div');
        this.messageContainerPrimary.classList.add(`messageContainer${this.elementID}`, `messageContainerPrimary${this.elementID}`);
        this.messageContainerPrimary.innerHTML = this.message;

        this.spinnerContainerMin = document.createElement('div');
        this.spinnerContainerMin.className = `spinnerContainerMin${this.elementID}`;
        this.spinnerMin = document.createElement('div');
        this.spinnerMin.classList.add(`spinner${this.elementID}`, `spinnerMin${this.elementID}`);
        this.messageContainerMin = document.createElement('div');
        this.messageContainerMin.classList.add(`messageContainer${this.elementID}`, `messageContainerMin${this.elementID}`);
        this.messageContainerMin.innerHTML = this.message;

        this.spinnerContainerPrimary.appendChild(this.spinnerPrimary);
        this.spinnerContainerPrimary.appendChild(this.messageContainerPrimary);
        this.spinnerContainerOuter.appendChild(this.spinnerContainerPrimary);

        this.spinnerContainerMin.appendChild(this.spinnerMin);
        this.spinnerContainerMin.appendChild(this.messageContainerMin);
        this.spinnerContainerOuter.appendChild(this.spinnerContainerMin);

        const style = document.createElement('style');
        style.innerHTML = `

            .spinnerOuterContainer${this.elementID} {
                width: 100%;
                height: 100%;
                margin: 0;
                top: 0;
                left: 0;
                position: absolute;
                pointer-events: none;
            }

            .messageContainer${this.elementID} {
                height: 20px;
                font-family: arial;
                font-size: 12pt;
                color: #ffffff;
                text-align: center;
                vertical-align: middle;
            }

            .spinner${this.elementID} {
                padding: 15px;
                background: #07e8d6;
                z-index:99999;
            
                aspect-ratio: 1;
                border-radius: 50%;
                --_m: 
                    conic-gradient(#0000,#000),
                    linear-gradient(#000 0 0) content-box;
                -webkit-mask: var(--_m);
                    mask: var(--_m);
                -webkit-mask-composite: source-out;
                    mask-composite: subtract;
                box-sizing: border-box;
                animation: load 1s linear infinite;
            }

            .spinnerContainerPrimary${this.elementID} {
                z-index:99999;
                background-color: rgba(128, 128, 128, 0.75);
                border: #666666 1px solid;
                border-radius: 5px;
                padding-top: 20px;
                padding-bottom: 10px;
                margin: 0;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-80px, -80px);
                width: 180px;
                pointer-events: auto;
            }

            .spinnerPrimary${this.elementID} {
                width: 120px;
                margin-left: 30px;
            }

            .messageContainerPrimary${this.elementID} {
                padding-top: 15px;
            }

            .spinnerContainerMin${this.elementID} {
                z-index:99999;
                background-color: rgba(128, 128, 128, 0.75);
                border: #666666 1px solid;
                border-radius: 5px;
                padding-top: 20px;
                padding-bottom: 15px;
                margin: 0;
                position: absolute;
                bottom: 50px;
                left: 50%;
                transform: translate(-50%, 0);
                display: flex;
                flex-direction: left;
                pointer-events: auto;
                min-width: 250px;
            }

            .messageContainerMin${this.elementID} {
                margin-right: 15px;
            }

            .spinnerMin${this.elementID} {
                width: 50px;
                height: 50px;
                margin-left: 15px;
                margin-right: 25px;
            }

            .messageContainerMin${this.elementID} {
                padding-top: 15px;
            }
            
            @keyframes load {
                to{transform: rotate(1turn)}
            }

        `;
        this.spinnerContainerOuter.appendChild(style);
        this.container.appendChild(this.spinnerContainerOuter);

        this.setMinimized(false, true);

        this.fadeTransitions = [];
    }

    addTask(message) {
        const newTask = {
            'message': message,
            'id': this.taskIDGen++
        };
        this.tasks.push(newTask);
        this.update();
        return newTask.id;
    }

    removeTask(id) {
        let index = 0;
        for (let task of this.tasks) {
            if (task.id === id) {
                this.tasks.splice(index, 1);
                break;
            }
            index++;
        }
        this.update();
    }

    removeAllTasks() {
        this.tasks = [];
        this.update();
    }

    setMessageForTask(id, message) {
        for (let task of this.tasks) {
            if (task.id === id) {
                task.message = message;
                break;
            }
        }
        this.update();
    }

    update() {
        if (this.tasks.length > 0) {
            this.show();
            this.setMessage(this.tasks[this.tasks.length - 1].message);
        } else {
            this.hide();
        }
    }

    show() {
        this.spinnerContainerOuter.style.display = 'block';
        this.visible = true;
    }

    hide() {
        this.spinnerContainerOuter.style.display = 'none';
        this.visible = false;
    }

    setContainer(container) {
        if (this.container && this.spinnerContainerOuter.parentElement === this.container) {
            this.container.removeChild(this.spinnerContainerOuter);
        }
        if (container) {
            this.container = container;
            this.container.appendChild(this.spinnerContainerOuter);
            this.spinnerContainerOuter.style.zIndex = this.container.style.zIndex + 1;
        }
    }

    setMinimized(minimized, instant) {
        const showHideSpinner = (element, show, instant, displayStyle, fadeTransitionsIndex) => {
            if (instant) {
                element.style.display = show ? displayStyle : 'none';
            } else {
                this.fadeTransitions[fadeTransitionsIndex] = fadeElement(element, !show, displayStyle, STANDARD_FADE_DURATION, () => {
                    this.fadeTransitions[fadeTransitionsIndex] = null;
                });
            }
        };
        showHideSpinner(this.spinnerContainerPrimary, !minimized, instant, 'block', 0);
        showHideSpinner(this.spinnerContainerMin, minimized, instant, 'flex', 1);
        this.minimized = minimized;
    }

    setMessage(msg) {
        this.messageContainerPrimary.innerHTML = msg;
        this.messageContainerMin.innerHTML = msg;
    }
}
