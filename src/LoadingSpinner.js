export class LoadingSpinner {

    constructor(message) {
        this.message = message || 'Loading...';

        this.spinnerDivContainer = document.createElement('div');
        this.spinnerDiv = document.createElement('div');
        this.messageDiv = document.createElement('div');
        this.spinnerDivContainer.className = 'loaderContainer';
        this.spinnerDiv.className = 'loader';
        this.spinnerDivContainer.style.display = 'none';
        this.messageDiv.className = 'message';
        this.messageDiv.innerHTML = this.message;
        this.spinnerDivContainer.appendChild(this.spinnerDiv);
        this.spinnerDivContainer.appendChild(this.messageDiv);
        document.body.appendChild(this.spinnerDivContainer);

        const style = document.createElement('style');
        style.innerHTML = `

            .message {
                font-family: arial;
                font-size: 12pt;
                color: #ffffff;
                text-align: center;
                padding-top:15px;
                width:180px;
            }

            .loaderContainer {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-80px, -80px);
                width: 180px;
            }

            .loader {
                width: 120px;        /* the size */
                padding: 15px;       /* the border thickness */
                background: #07e8d6; /* the color */
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
                margin-left: 30px;
            }
            
            @keyframes load {
                to{transform: rotate(1turn)}
            }

        `;
        document.getElementsByTagName('head')[0].appendChild(style);
    }

    show() {
        this.spinnerDivContainer.style.display = 'block';
    }

    hide() {
        this.spinnerDivContainer.style.display = 'none';
    }

    setMessage(msg) {
        this.messageDiv.innerHTML = msg;
    }
}
