FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Create necessary directories
RUN mkdir -p logs data 
RUN mkdir -p logs/clients
RUN mkdir -p data/clients

# Set environment variables
ENV NODE_ENV=production

CMD ["npm", "start"] 