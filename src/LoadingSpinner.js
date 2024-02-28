export class LoadingSpinner {

    constructor(message, container) {

        this.idGen = 0;

        this.tasks = [];

        this.message = message || 'Loading...';
        this.container = container || document.body;

        this.spinnerContainerOuter = document.createElement('div');
        this.spinnerContainerOuter.className = 'spinnerOuterContainer';
        this.spinnerContainerOuter.style.display = 'none';

        this.spinnerContainerPrimary = document.createElement('div');
        this.spinnerContainerPrimary.className = 'spinnerContainerPrimary';
        this.spinnerPrimary = document.createElement('div');
        this.spinnerPrimary.classList.add('spinner', 'spinnerPrimary');
        this.messageContainerPrimary = document.createElement('div');
        this.messageContainerPrimary.classList.add('messageContainer', 'messageContainerPrimary');
        this.messageContainerPrimary.innerHTML = this.message;

        this.spinnerContainerMin = document.createElement('div');
        this.spinnerContainerMin.className = 'spinnerContainerMin';
        this.spinnerMin = document.createElement('div');
        this.spinnerMin.classList.add('spinner', 'spinnerMin');
        this.messageContainerMin = document.createElement('div');
        this.messageContainerMin.classList.add('messageContainer', 'messageContainerMin');
        this.messageContainerMin.innerHTML = this.message;

        this.spinnerContainerPrimary.appendChild(this.spinnerPrimary);
        this.spinnerContainerPrimary.appendChild(this.messageContainerPrimary);
        this.spinnerContainerOuter.appendChild(this.spinnerContainerPrimary);

        this.spinnerContainerMin.appendChild(this.spinnerMin);
        this.spinnerContainerMin.appendChild(this.messageContainerMin);
        this.spinnerContainerOuter.appendChild(this.spinnerContainerMin);

        this.container.appendChild(this.spinnerContainerOuter);

        const style = document.createElement('style');
        style.innerHTML = `

            .spinnerOuterContainer {
                width: 100%;
                height: 100%;
                margin: 0;
                top: 0;
                left: 0;
                position: absolute;
            }

            .messageContainer {
                font-family: arial;
                font-size: 12pt;
                color: #ffffff;
                text-align: center;
                padding-top:15px;
            }

            .spinner {
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

            .spinnerContainerPrimary {
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
            }

            .spinnerPrimary {
                width: 120px;
                margin-left: 30px;
            }

            .spinnerContainerMin {
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
            }

            .messageContainerMin {
                margin-right: 15px;
            }

            .spinnerMin {
                width: 50px;
                margin-left: 15px;
                margin-right: 15px;
            }
            
            @keyframes load {
                to{transform: rotate(1turn)}
            }

        `;
        this.spinnerContainerOuter.appendChild(style);
        this.setMinimized(false);
    }

    addTask(message) {
        const newTask = {
            'message': message,
            'id': this.idGen++
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
    }

    hide() {
        this.spinnerContainerOuter.style.display = 'none';
    }

    setContainer(container) {
        if (this.container) {
            this.container.removeChild(this.spinnerContainerOuter);
        }
        this.container = container;
        this.container.appendChild(this.spinnerContainerOuter);
        this.spinnerContainerOuter.style.zIndex = this.container.style.zIndex + 1;
    }

    setMinimized(minimized) {
        if (minimized) {
            this.spinnerContainerPrimary.style.display = 'none';
            this.spinnerContainerMin.style.display = 'flex';
        } else {
            this.spinnerContainerPrimary.style.display = 'block';
            this.spinnerContainerMin.style.display = 'none';
        }
        this.minimized = minimized;
    }

    setMessage(msg) {
        this.messageContainerPrimary.innerHTML = msg;
        this.messageContainerMin.innerHTML = msg;
    }
}
